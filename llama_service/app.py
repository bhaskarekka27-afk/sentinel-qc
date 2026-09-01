"""
Sentinel QC — local LLAMA inference & LoRA fine-tuning service.
Runs as a FastAPI server that the Node.js backend calls over HTTP.
"""

import os, json, threading, time, traceback
from pathlib import Path
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from sentence_transformers import SentenceTransformer

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
MODELS_DIR = DATA_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

BASE_MODEL = os.environ.get("LLAMA_MODEL", "meta-llama/Llama-3.2-3B-Instruct")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# ── Global state ──────────────────────────────────────────────────────
model = None
tokenizer = None
embed_model = None
lora_adapters: dict[str, str] = {}  # exam_slug -> adapter path
training_jobs: dict[str, dict] = {}
lock = threading.Lock()


def load_base_model():
    global model, tokenizer
    print(f"[llama] Loading {BASE_MODEL} on {DEVICE}...")
    quant = None
    if DEVICE == "cuda":
        quant = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_quant_type="nf4",
        )
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=quant,
        device_map="auto" if DEVICE == "cuda" else None,
        torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
    )
    if DEVICE == "cpu":
        model = model.to(DEVICE)
    model.eval()
    print(f"[llama] Model loaded on {DEVICE}")


def load_embed_model():
    global embed_model
    print(f"[llama] Loading embedding model {EMBED_MODEL}...")
    embed_model = SentenceTransformer(EMBED_MODEL, device=DEVICE)
    print("[llama] Embedding model loaded")


def discover_adapters():
    for d in MODELS_DIR.iterdir():
        if d.is_dir() and (d / "adapter_config.json").exists():
            lora_adapters[d.name] = str(d)
            print(f"[llama] Found LoRA adapter: {d.name}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_base_model()
    load_embed_model()
    discover_adapters()
    yield


app = FastAPI(title="Sentinel QC — LLAMA Service", lifespan=lifespan)


# ── Schemas ───────────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    system: str
    prompt: str
    exam_slug: str | None = None
    max_tokens: int = 2048
    temperature: float = 0.1

class DetectRequest(BaseModel):
    system: str
    prompt: str
    max_tokens: int = 1024

class EmbedRequest(BaseModel):
    text: str

class TrainRequest(BaseModel):
    exam_slug: str
    jsonl_data: str
    epochs: int = Field(default=3, ge=1, le=20)
    learning_rate: float = Field(default=2e-4, gt=0)
    lora_r: int = Field(default=16, ge=4, le=128)
    lora_alpha: int = Field(default=32, ge=4, le=256)


# ── Inference ─────────────────────────────────────────────────────────
def generate(system: str, prompt: str, exam_slug: str | None = None,
             max_tokens: int = 2048, temperature: float = 0.1) -> str:
    active_model = model
    # Load LoRA adapter if available for this exam
    if exam_slug and exam_slug in lora_adapters:
        from peft import PeftModel
        adapter_path = lora_adapters[exam_slug]
        active_model = PeftModel.from_pretrained(model, adapter_path)
        active_model.eval()

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    input_text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(input_text, return_tensors="pt", truncation=True, max_length=4096)
    inputs = {k: v.to(active_model.device if hasattr(active_model, 'device') else DEVICE) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = active_model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            temperature=max(temperature, 0.01),
            do_sample=temperature > 0,
            pad_token_id=tokenizer.pad_token_id,
        )
    new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True)


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    try:
        text = generate(req.system, req.prompt, req.exam_slug, req.max_tokens, req.temperature)
        return {"text": text}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))


@app.post("/detect")
async def detect(req: DetectRequest):
    try:
        text = generate(req.system, req.prompt, max_tokens=req.max_tokens)
        return {"text": text}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))


# ── Embeddings ────────────────────────────────────────────────────────
@app.post("/embed")
async def embed(req: EmbedRequest):
    vec = embed_model.encode(req.text[:8000]).tolist()
    return {"vector": vec, "method": "local", "dimensions": len(vec)}


# ── Fine-tuning (LoRA) ───────────────────────────────────────────────
def run_training(job_id: str, exam_slug: str, jsonl_data: str,
                 epochs: int, lr: float, lora_r: int, lora_alpha: int):
    from peft import LoraConfig, get_peft_model, TaskType
    from datasets import Dataset

    job = training_jobs[job_id]
    try:
        job["status"] = "running"
        job["logs"].append(f"[start] Training {exam_slug} for {epochs} epochs")

        lines = [json.loads(l) for l in jsonl_data.strip().split("\n") if l.strip()]
        if not lines:
            raise ValueError("No training data")

        # Build training pairs from the JSONL format
        train_texts = []
        for entry in lines:
            sys_text = entry.get("systemInstruction", {}).get("parts", [{}])[0].get("text", "")
            contents = entry.get("contents", [])
            user_text = ""
            model_text = ""
            for c in contents:
                if c["role"] == "user":
                    user_text = c["parts"][0]["text"]
                elif c["role"] == "model":
                    model_text = c["parts"][0]["text"]

            messages = [
                {"role": "system", "content": sys_text},
                {"role": "user", "content": user_text},
                {"role": "assistant", "content": model_text},
            ]
            full = tokenizer.apply_chat_template(messages, tokenize=False)
            train_texts.append(full)

        job["logs"].append(f"[data] {len(train_texts)} training examples prepared")

        # Tokenize
        def tokenize_fn(examples):
            out = tokenizer(examples["text"], truncation=True, max_length=2048, padding="max_length")
            out["labels"] = out["input_ids"].copy()
            return out

        ds = Dataset.from_dict({"text": train_texts}).map(tokenize_fn, batched=True, remove_columns=["text"])
        ds.set_format("torch")

        # LoRA config
        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=lora_r,
            lora_alpha=lora_alpha,
            lora_dropout=0.05,
            target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
        )

        peft_model = get_peft_model(model, lora_config)
        trainable = sum(p.numel() for p in peft_model.parameters() if p.requires_grad)
        total = sum(p.numel() for p in peft_model.parameters())
        job["logs"].append(f"[lora] Trainable: {trainable:,} / {total:,} params ({100*trainable/total:.2f}%)")

        # Training loop
        from torch.utils.data import DataLoader
        from torch.optim import AdamW

        loader = DataLoader(ds, batch_size=1, shuffle=True)
        optimizer = AdamW(peft_model.parameters(), lr=lr)
        peft_model.train()

        for epoch in range(epochs):
            total_loss = 0
            for step, batch in enumerate(loader):
                batch = {k: v.to(peft_model.device if hasattr(peft_model, 'device') else DEVICE) for k, v in batch.items()}
                outputs = peft_model(**batch)
                loss = outputs.loss
                loss.backward()
                optimizer.step()
                optimizer.zero_grad()
                total_loss += loss.item()

            avg_loss = total_loss / max(len(loader), 1)
            job["logs"].append(f"[epoch {epoch+1}/{epochs}] loss: {avg_loss:.4f}")
            job["progress"] = {"epoch": epoch + 1, "totalEpochs": epochs, "loss": round(avg_loss, 4)}

        # Save adapter
        out_dir = MODELS_DIR / exam_slug
        out_dir.mkdir(parents=True, exist_ok=True)
        peft_model.save_pretrained(str(out_dir))
        lora_adapters[exam_slug] = str(out_dir)

        job["status"] = "succeeded"
        job["adapter_path"] = str(out_dir)
        job["logs"].append(f"[done] Adapter saved to {out_dir}")

    except Exception as e:
        traceback.print_exc()
        job["status"] = "failed"
        job["error"] = str(e)
        job["logs"].append(f"[error] {e}")


@app.post("/train")
async def train(req: TrainRequest):
    job_id = f"job-{int(time.time())}"
    training_jobs[job_id] = {
        "id": job_id,
        "exam_slug": req.exam_slug,
        "status": "queued",
        "logs": [],
        "progress": None,
        "error": None,
        "adapter_path": None,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    t = threading.Thread(
        target=run_training,
        args=(job_id, req.exam_slug, req.jsonl_data, req.epochs, req.learning_rate, req.lora_r, req.lora_alpha),
        daemon=True,
    )
    t.start()
    return training_jobs[job_id]


@app.get("/train/{job_id}")
async def get_train_job(job_id: str):
    if job_id not in training_jobs:
        raise HTTPException(404, "Job not found")
    return training_jobs[job_id]


@app.get("/status")
async def status():
    return {
        "model": BASE_MODEL,
        "device": DEVICE,
        "cuda_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "adapters": list(lora_adapters.keys()),
        "embed_model": EMBED_MODEL,
        "ready": model is not None,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("LLAMA_PORT", 8788))
    uvicorn.run(app, host="0.0.0.0", port=port)
