"""
Build and export CPU-only INT8 ONNX models for CAMPUS-NEXUS:
1. dkt_gru_int8.onnx: GRU-based Deep Knowledge Tracing model
2. vision_triage_int8.onnx: Lightweight MobileNet-style defect classifier
"""
import os
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.quantization import QuantType, quantize_dynamic

ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
os.makedirs(ARTIFACT_DIR, exist_ok=True)


def build_dkt_gru_onnx(fp32_path: str, int8_path: str):
    rng = np.random.default_rng(42)
    input_size = 12   # 6 concepts * 2 (correct/incorrect)
    hidden_size = 16
    num_concepts = 6

    # ONNX GRU expects W: [num_directions, 3*hidden_size, input_size], R: [1, 3*hidden_size, hidden_size]
    W = rng.normal(0, 0.25, size=(1, 3 * hidden_size, input_size)).astype(np.float32)
    R = rng.normal(0, 0.20, size=(1, 3 * hidden_size, hidden_size)).astype(np.float32)
    B = np.zeros((1, 6 * hidden_size), dtype=np.float32)
    proj_w = rng.normal(0, 0.35, size=(hidden_size, num_concepts)).astype(np.float32)
    proj_b = np.zeros((num_concepts,), dtype=np.float32)

    X = helper.make_tensor_value_info("interactions", TensorProto.FLOAT, [1, None, input_size])
    Y = helper.make_tensor_value_info("mastery_probs", TensorProto.FLOAT, [1, num_concepts])

    # Transpose [1, seq, feat] -> [seq, 1, feat] for ONNX GRU
    n_trans = helper.make_node("Transpose", inputs=["interactions"], outputs=["x_seq"], perm=[1, 0, 2])
    n_gru = helper.make_node(
        "GRU",
        inputs=["x_seq", "W", "R", "B"],
        outputs=["Y_seq", "Y_h"],
        hidden_size=hidden_size,
    )
    n_squeeze = helper.make_node("Squeeze", inputs=["Y_h", "squeeze_axes"], outputs=["h_last"])
    n_matmul = helper.make_node("MatMul", inputs=["h_last", "proj_w"], outputs=["logits_raw"])
    n_add = helper.make_node("Add", inputs=["logits_raw", "proj_b"], outputs=["logits"])
    n_sig = helper.make_node("Sigmoid", inputs=["logits"], outputs=["mastery_probs"])

    graph = helper.make_graph(
        [n_trans, n_gru, n_squeeze, n_matmul, n_add, n_sig],
        "CampusNexus_DKT_GRU",
        [X],
        [Y],
        initializer=[
            numpy_helper.from_array(W, name="W"),
            numpy_helper.from_array(R, name="R"),
            numpy_helper.from_array(B, name="B"),
            numpy_helper.from_array(np.array([0], dtype=np.int64), name="squeeze_axes"),
            numpy_helper.from_array(proj_w, name="proj_w"),
            numpy_helper.from_array(proj_b, name="proj_b"),
        ],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    onnx.save(model, fp32_path)
    quantize_dynamic(fp32_path, int8_path, weight_type=QuantType.QUInt8)


def build_vision_triage_onnx(fp32_path: str, int8_path: str):
    rng = np.random.default_rng(7)
    # Input: [1, 3, 64, 64] -> Conv 3x3 (16 ch) -> Relu -> GlobalAveragePool -> Flatten -> MatMul -> Add -> Logits (6 classes)
    conv_w = rng.normal(0, 0.2, size=(16, 3, 3, 3)).astype(np.float32)
    conv_b = np.zeros((16,), dtype=np.float32)
    fc_w = rng.normal(0, 0.3, size=(16, 6)).astype(np.float32)
    # Slight RGB channel bias priors to separate warm/red electrical sparks vs blue/cyan plumbing vs neutral hardware
    fc_w[0, 0] += 0.6  # electrical
    fc_w[2, 1] += 0.6  # plumbing
    fc_w[1, 2] += 0.5  # it_hardware
    fc_b = np.array([0.05, 0.05, 0.05, 0.02, 0.02, 0.01], dtype=np.float32)

    X = helper.make_tensor_value_info("image", TensorProto.FLOAT, [1, 3, 64, 64])
    Y = helper.make_tensor_value_info("class_logits", TensorProto.FLOAT, [1, 6])

    n_conv = helper.make_node("Conv", inputs=["image", "conv_w", "conv_b"], outputs=["c1"], kernel_shape=[3, 3], pads=[1, 1, 1, 1])
    n_relu = helper.make_node("Relu", inputs=["c1"], outputs=["r1"])
    n_gap = helper.make_node("GlobalAveragePool", inputs=["r1"], outputs=["gap"])
    n_flat = helper.make_node("Flatten", inputs=["gap"], outputs=["flat"], axis=1)
    n_mm = helper.make_node("MatMul", inputs=["flat", "fc_w"], outputs=["mm"])
    n_add = helper.make_node("Add", inputs=["mm", "fc_b"], outputs=["class_logits"])

    graph = helper.make_graph(
        [n_conv, n_relu, n_gap, n_flat, n_mm, n_add],
        "CampusNexus_MobileNet_Triage",
        [X],
        [Y],
        initializer=[
            numpy_helper.from_array(conv_w, name="conv_w"),
            numpy_helper.from_array(conv_b, name="conv_b"),
            numpy_helper.from_array(fc_w, name="fc_w"),
            numpy_helper.from_array(fc_b, name="fc_b"),
        ],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    onnx.save(model, fp32_path)
    quantize_dynamic(fp32_path, int8_path, weight_type=QuantType.QUInt8)


if __name__ == "__main__":
    dkt_fp32 = os.path.join(ARTIFACT_DIR, "dkt_gru_fp32.onnx")
    dkt_int8 = os.path.join(ARTIFACT_DIR, "dkt_gru_int8.onnx")
    vis_fp32 = os.path.join(ARTIFACT_DIR, "vision_triage_fp32.onnx")
    vis_int8 = os.path.join(ARTIFACT_DIR, "vision_triage_int8.onnx")
    build_dkt_gru_onnx(dkt_fp32, dkt_int8)
    build_vision_triage_onnx(vis_fp32, vis_int8)
    print("Exported INT8 ONNX models:", os.listdir(ARTIFACT_DIR))
