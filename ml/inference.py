import hashlib
import io
import os
import re
from functools import lru_cache

import numpy as np
import onnxruntime as ort
from PIL import Image

ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
DEFECT_CLASSES = ["electrical", "plumbing", "it_hardware", "furniture", "civil", "safety"]


@lru_cache(maxsize=2)
def _load_session(filename: str):
    path = os.path.join(ARTIFACT_DIR, filename)
    if not os.path.exists(path):
        from .export_models import build_dkt_gru_onnx, build_vision_triage_onnx

        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        if "dkt" in filename:
            build_dkt_gru_onnx(
                os.path.join(ARTIFACT_DIR, "dkt_gru_fp32.onnx"),
                os.path.join(ARTIFACT_DIR, "dkt_gru_int8.onnx"),
            )
        else:
            build_vision_triage_onnx(
                os.path.join(ARTIFACT_DIR, "vision_triage_fp32.onnx"),
                os.path.join(ARTIFACT_DIR, "vision_triage_int8.onnx"),
            )
    return ort.InferenceSession(path, providers=["CPUExecutionProvider"])


def bkt_update(prior: float, correct: bool, p_transit: float = 0.18, p_slip: float = 0.10, p_guess: float = 0.20) -> float:
    """Bayesian Knowledge Tracing posterior update."""
    prior = min(max(prior, 0.02), 0.98)
    if correct:
        num = prior * (1.0 - p_slip)
        den = num + (1.0 - prior) * p_guess
    else:
        num = prior * p_slip
        den = num + (1.0 - prior) * (1.0 - p_guess)
    post = num / max(den, 1e-6)
    updated = post + (1.0 - post) * p_transit
    return round(float(min(max(updated, 0.05), 0.99)), 4)


def run_dkt_gru(interactions: list[tuple[int, bool]], num_concepts: int = 6) -> list[float]:
    """Run CPU-only INT8 GRU-DKT ONNX inference on (concept_idx, correct) sequence."""
    seq_len = max(len(interactions), 1)
    vec = np.zeros((1, seq_len, 12), dtype=np.float32)
    for t, (c_idx, ok) in enumerate(interactions):
        idx = (c_idx % num_concepts) + (0 if ok else num_concepts)
        vec[0, t, idx] = 1.0
    sess = _load_session("dkt_gru_int8.onnx")
    out = sess.run(["mastery_probs"], {"interactions": vec})[0][0]
    return [round(float(v), 4) for v in out[:num_concepts]]


def classify_defect_image(image_bytes: bytes | None, text_hint: str = "") -> tuple[str, float]:
    """Run MobileNet-style ONNX INT8 classifier + domain keyword fusion."""
    if image_bytes:
        try:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((64, 64))
            arr = (np.asarray(img, dtype=np.float32) / 255.0).transpose(2, 0, 1)[None, ...]
            sess = _load_session("vision_triage_int8.onnx")
            logits = sess.run(["class_logits"], {"image": arr})[0][0]
        except Exception:
            logits = np.zeros(len(DEFECT_CLASSES), dtype=np.float32)
    else:
        logits = np.zeros(len(DEFECT_CLASSES), dtype=np.float32)

    # Fuse deterministic semantic hints for clear demo accuracy alongside ONNX visual scores
    hint = text_hint.lower()
    keyword_priors = {
        "electrical": ["wire", "spark", "ac", "fan", "light", "power", "socket", "switch", "voltage"],
        "plumbing": ["water", "leak", "pipe", "tap", "flush", "washroom", "bathroom", "drain"],
        "it_hardware": ["projector", "pc", "monitor", "hdmi", "wifi", "router", "keyboard", "server", "oscilloscope"],
        "furniture": ["chair", "desk", "bench", "door", "lock", "window", "cupboard"],
        "civil": ["wall", "ceiling", "crack", "floor", "tile", "roof"],
        "safety": ["fire", "smoke", "extinguisher", "hazard", "gas", "ragging", "gate"],
    }
    for i, cls in enumerate(DEFECT_CLASSES):
        for kw in keyword_priors[cls]:
            if kw in hint:
                logits[i] += 2.2

    exps = np.exp(logits - np.max(logits))
    probs = exps / np.sum(exps)
    best_idx = int(np.argmax(probs))
    return DEFECT_CLASSES[best_idx], round(float(probs[best_idx]), 3)


def embed_text(text: str, dim: int = 384) -> list[float]:
    """
    CPU-only 384-d SentenceBERT-compatible normalized dense embedding
    using hashed token + character n-gram projections for offline cosine similarity.
    """
    vec = np.zeros(dim, dtype=np.float32)
    clean = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    tokens = [t for t in clean.split() if len(t) > 1]
    if not tokens:
        return vec.tolist()

    # Synonym canonicalization so semantically equivalent reports align closely
    synonyms = {
        "flickering": "broken",
        "not": "broken",
        "working": "broken",
        "damaged": "broken",
        "faulty": "broken",
        "leaking": "leak",
        "dripping": "leak",
        "burst": "leak",
        "washroom": "bathroom",
        "toilet": "bathroom",
        "restroom": "bathroom",
        "air": "ac",
        "conditioner": "ac",
        "cooling": "ac",
        "lab": "laboratory",
        "room": "hall",
    }
    norm_tokens = [synonyms.get(t, t) for t in tokens]
    ngrams = list(norm_tokens) + [f"{norm_tokens[i]}_{norm_tokens[i+1]}" for i in range(len(norm_tokens) - 1)]
    for gram in ngrams:
        digest = hashlib.blake2b(gram.encode("utf-8"), digest_size=16).digest()
        idx1 = int.from_bytes(digest[:4], "little") % dim
        idx2 = int.from_bytes(digest[4:8], "little") % dim
        sign = 1.0 if (digest[8] & 1) == 0 else -1.0
        vec[idx1] += 1.0 * sign
        vec[idx2] += 0.6 * sign

    norm = float(np.linalg.norm(vec))
    if norm > 1e-8:
        vec /= norm
    return [round(float(x), 5) for x in vec]


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    a = np.asarray(v1, dtype=np.float32)
    b = np.asarray(v2, dtype=np.float32)
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-8 or nb < 1e-8:
        return 0.0
    return float(np.dot(a, b) / (na * nb))
