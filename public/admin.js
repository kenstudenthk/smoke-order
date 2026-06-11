// ── 價單管理頁邏輯 ──
const CAT_OPTIONS = ["濃", "純", "純幼", "薄荷粗", "薄荷幼", "中關"];
const MAX_IMG_EDGE = 2000;
const MAX_TOTAL_BASE64 = 24_000_000;

let currentList = null; // 現行產品列表（KV 或 BASE fallback）
let diff = null;        // {added:[], changed:[], removed:[]}

// 記住密碼（sessionStorage，關 tab 就冇）
const pwInput = document.getElementById("pw");
pwInput.value = sessionStorage.getItem("adminPw") || "";
pwInput.addEventListener("change", () => sessionStorage.setItem("adminPw", pwInput.value));

document.getElementById("files").addEventListener("change", showThumbs);

function setStatus(kind, msg) {
  const el = document.getElementById("status");
  if (!kind) { el.className = "adm-status"; el.textContent = ""; return; }
  el.className = "adm-status show " + kind;
  el.textContent = msg;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function showThumbs() {
  const box = document.getElementById("thumbs");
  box.innerHTML = "";
  for (const f of document.getElementById("files").files) {
    if (f.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      box.appendChild(img);
    }
  }
}

// ── 檔案 → base64 ──
async function imageToJpegBase64(file) {
  let img;
  try {
    img = await createImageBitmap(file);
  } catch {
    // createImageBitmap 唔食呢個格式 → 行 <img> 路徑（Safari 處理 HEIC）
    img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("圖片讀取失敗（格式可能唔支援）"));
      i.src = URL.createObjectURL(file);
    });
  }
  const w = img.width, h = img.height;
  const scale = Math.min(1, MAX_IMG_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("檔案讀取失敗"));
    r.readAsDataURL(file);
  });
}

async function buildPayload(files) {
  const pdfs = files.filter((f) => f.type === "application/pdf");
  if (pdfs.length > 1 || (pdfs.length === 1 && files.length > 1)) {
    throw new Error("PDF 只可以單獨上傳一份");
  }
  const out = [];
  for (const f of files) {
    if (f.type === "application/pdf") {
      out.push({ mediaType: "application/pdf", data: await fileToBase64(f) });
    } else {
      out.push({ mediaType: "image/jpeg", data: await imageToJpegBase64(f) });
    }
  }
  const total = out.reduce((s, x) => s + x.data.length, 0);
  if (total > MAX_TOTAL_BASE64) throw new Error("檔案總大小超出限制，請縮細或分批上傳");
  return out;
}

// ── 解析 ──
async function doParse() {
  const pw = pwInput.value.trim();
  if (!pw) { setStatus("err", "請先輸入管理密碼"); return; }
  const files = [...document.getElementById("files").files];
  if (!files.length) { setStatus("err", "請先揀價單檔案"); return; }

  const btn = document.getElementById("parseBtn");
  btn.disabled = true;
  document.getElementById("diffCard").style.display = "none";
  setStatus("busy", "⏳ AI 解析中，可能需要一兩分鐘，請唔好離開呢頁…");

  try {
    const payload = await buildPayload(files);

    const [parseRes, curRes] = await Promise.all([
      fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": pw },
        body: JSON.stringify({ files: payload }),
      }),
      fetch("/api/products", { cache: "no-store" }),
    ]);

    const parseData = await parseRes.json();
    if (!parseRes.ok) throw new Error(parseData.error || "解析失敗");

    let cur = null;
    if (curRes.ok) cur = (await curRes.json()).products;
    currentList = Array.isArray(cur) && cur.length ? cur : BASE.map((p) => ({ ...p }));

    diff = computeDiff(currentList, parseData.products);
    renderDiff(parseData.products.length);
    setStatus("", "");
  } catch (e) {
    setStatus("err", "❌ " + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

// ── Diff ──
function computeDiff(cur, parsed) {
  const curMap = new Map(cur.map((p) => [p.name, p]));
  const parsedMap = new Map(parsed.map((p) => [p.name, p]));
  const added = parsed.filter((p) => !curMap.has(p.name));
  const removed = cur.filter((p) => !parsedMap.has(p.name));
  const changed = [];
  for (const p of parsed) {
    const old = curMap.get(p.name);
    if (old && old.price !== p.price) changed.push({ ...p, oldPrice: old.price });
  }
  return { added, changed, removed };
}

function catSelect(idx, val) {
  return `<select class="fld" data-fld="cat" data-idx="${idx}">` +
    CAT_OPTIONS.map((c) => `<option ${c === val ? "selected" : ""}>${c}</option>`).join("") +
    `</select>`;
}

function renderDiff(parsedCount) {
  const { added, changed, removed } = diff;
  document.getElementById("parseCount").textContent =
    `AI 共解析出 ${parsedCount} 項產品 ｜ 新增 ${added.length}、改價 ${changed.length}、建議移除 ${removed.length}`;

  let html = "";
  if (added.length) {
    html += `<div class="adm-sec add"><h3>🆕 新增（${added.length}）</h3>` + added.map((p, i) => `
      <div class="adm-item">
        <input type="checkbox" data-grp="added" data-idx="${i}" checked>
        <input class="fld fld-flag" data-fld="flag" data-idx="${i}" value="${esc(p.flag)}">
        <input class="fld fld-name" data-fld="name" data-idx="${i}" value="${esc(p.name)}">
        ${catSelect(i, p.cat)}
        $<input class="fld fld-price" type="number" data-fld="price" data-idx="${i}" value="${p.price}">
      </div>`).join("") + `</div>`;
  }
  if (changed.length) {
    html += `<div class="adm-sec chg"><h3>💲 改價（${changed.length}）</h3>` + changed.map((p, i) => `
      <div class="adm-item">
        <input type="checkbox" data-grp="changed" data-idx="${i}" checked>
        <span class="nm">${esc(p.flag)} ${esc(p.name)}</span>
        <span class="adm-old">$${p.oldPrice}</span>→
        $<input class="fld fld-price" type="number" data-fld="price" data-idx="${i}" value="${p.price}">
      </div>`).join("") + `</div>`;
  }
  if (removed.length) {
    html += `<div class="adm-sec del"><h3>🗑️ 建議移除 — 價單上搵唔到（預設唔剔，剔咗先會刪）</h3>` + removed.map((p, i) => `
      <div class="adm-item">
        <input type="checkbox" data-grp="removed" data-idx="${i}">
        <span class="nm">${esc(p.flag)} ${esc(p.name)} — $${p.price}</span>
      </div>`).join("") + `</div>`;
  }
  if (!html) html = `<p>✨ 解析結果同現行價單完全一樣，無需更新。</p>`;

  document.getElementById("diffBody").innerHTML = html;
  document.getElementById("diffCard").style.display = "";
  document.getElementById("confirmBtn").disabled = !(added.length || changed.length || removed.length);
}

// ── 確認更新 ──
function collectSection(grp) {
  const checks = [...document.querySelectorAll(`input[type=checkbox][data-grp=${grp}]`)];
  return new Set(checks.filter((c) => c.checked).map((c) => +c.dataset.idx));
}

function readEdits(grp, list) {
  // 從預覽 UI 讀返用戶即場修改嘅欄位
  const sec = { added: ".adm-sec.add", changed: ".adm-sec.chg" }[grp];
  const root = document.querySelector(sec);
  if (!root) return list;
  return list.map((p, i) => {
    const get = (fld) => root.querySelector(`[data-fld=${fld}][data-idx="${i}"]`);
    const out = { ...p };
    for (const fld of ["flag", "name", "cat"]) {
      const el = get(fld);
      if (el) out[fld] = el.value.trim();
    }
    const priceEl = get("price");
    if (priceEl) out.price = parseFloat(priceEl.value);
    return out;
  });
}

async function doConfirm() {
  const pw = pwInput.value.trim();
  const addedSel = collectSection("added");
  const changedSel = collectSection("changed");
  const removedSel = collectSection("removed");

  const added = readEdits("added", diff.added).filter((_, i) => addedSel.has(i));
  const changed = readEdits("changed", diff.changed).filter((_, i) => changedSel.has(i));
  const removedNames = new Set(diff.removed.filter((_, i) => removedSel.has(i)).map((p) => p.name));
  const changedMap = new Map(changed.map((p) => [p.name, p.price]));

  // 現行列表 → 套用移除/改價，保持原有次序
  let next = currentList
    .filter((p) => !removedNames.has(p.name))
    .map((p) => (changedMap.has(p.name) ? { ...p, price: changedMap.get(p.name) } : { ...p }));

  // 新產品插入所屬類別最尾，保持類別分組
  for (const p of added) {
    let insertAt = -1;
    for (let i = 0; i < next.length; i++) if (next[i].cat === p.cat) insertAt = i;
    const item = { cat: p.cat, flag: p.flag, name: p.name, price: p.price };
    if (insertAt >= 0) next.splice(insertAt + 1, 0, item);
    else next.push(item);
  }

  const btn = document.getElementById("confirmBtn");
  btn.disabled = true;
  setStatus("busy", "⏳ 更新緊…");
  try {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": pw },
      body: JSON.stringify({ products: next }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "更新失敗");
    setStatus("ok", `✅ 已更新！而家共 ${data.count} 項產品。客人重新整理主頁就會見到新價單。`);
    document.getElementById("diffCard").style.display = "none";
    currentList = next;
  } catch (e) {
    setStatus("err", "❌ " + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}
