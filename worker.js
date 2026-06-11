import Anthropic from "@anthropic-ai/sdk";

const KV_KEY = "products";
const CATS = ["濃", "純", "純幼", "薄荷粗", "薄荷幼", "中關"];
const MAX_TOTAL_BASE64 = 25_000_000; // ~18MB binary, under Claude API 32MB request limit

const PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cat: { type: "string", enum: CATS },
          flag: { type: "string" },
          name: { type: "string" },
          price: { type: "number" },
        },
        required: ["cat", "flag", "name", "price"],
        additionalProperties: false,
      },
    },
  },
  required: ["products"],
  additionalProperties: false,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function authorized(request, env) {
  const pw = request.headers.get("X-Admin-Password");
  return Boolean(pw) && pw === env.ADMIN_PASSWORD;
}

function validateProducts(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 500) {
    return "產品列表必須係 1-500 項嘅陣列";
  }
  const names = new Set();
  for (const p of list) {
    if (!p || typeof p !== "object") return "每項必須係物件";
    if (typeof p.cat !== "string" || !p.cat.trim()) return "cat 唔可以空";
    if (typeof p.flag !== "string") return "flag 必須係字串";
    if (typeof p.name !== "string" || !p.name.trim()) return "name 唔可以空";
    if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price <= 0) {
      return `「${p.name}」嘅 price 必須係正數`;
    }
    if (names.has(p.name)) return `產品名重複：「${p.name}」`;
    names.add(p.name);
  }
  return null;
}

async function handleGetProducts(env) {
  const stored = await env.PRODUCTS_KV.get(KV_KEY, "json");
  return json({ products: stored ?? null });
}

async function handleSaveProducts(request, env) {
  if (!authorized(request, env)) return json({ error: "密碼錯誤" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "請求格式錯誤" }, 400);
  }
  const err = validateProducts(body.products);
  if (err) return json({ error: err }, 400);
  // strip any extra fields before storing
  const clean = body.products.map((p) => ({
    cat: p.cat.trim(),
    flag: p.flag.trim(),
    name: p.name.trim(),
    price: p.price,
  }));
  await env.PRODUCTS_KV.put(KV_KEY, JSON.stringify(clean));
  return json({ ok: true, count: clean.length });
}

async function handleParse(request, env) {
  if (!authorized(request, env)) return json({ error: "密碼錯誤" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "請求格式錯誤" }, 400);
  }
  const files = body.files;
  if (!Array.isArray(files) || files.length === 0) {
    return json({ error: "請上傳至少一個檔案" }, 400);
  }
  const totalSize = files.reduce((s, f) => s + (f.data?.length || 0), 0);
  if (totalSize > MAX_TOTAL_BASE64) {
    return json({ error: "檔案太大，請縮細或分開上傳" }, 400);
  }

  const allowedImages = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const blocks = [];
  for (const f of files) {
    if (!f || typeof f.data !== "string" || !f.data) {
      return json({ error: "檔案資料缺失" }, 400);
    }
    if (f.mediaType === "application/pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: f.data },
      });
    } else if (allowedImages.includes(f.mediaType)) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: f.mediaType, data: f.data },
      });
    } else {
      return json({ error: `唔支援嘅檔案格式：${f.mediaType}` }, 400);
    }
  }

  const current = (await env.PRODUCTS_KV.get(KV_KEY, "json")) ?? [];
  const currentNames = current.map((p) => `${p.cat}｜${p.flag}｜${p.name}｜$${p.price}`).join("\n");

  const system = `你係香煙價單解析專家。用戶會上傳供應商價單（相片或 PDF），你要解析出完整產品列表。

規則：
1. 輸出價單上**全部**產品，一隻都唔可以漏。
2. cat 分類必須係以下六類之一：${CATS.join("、")}。「濃」= 濃味，「純」= 純味/淡味，「純幼」= 幼支純味，「薄荷粗」= 標準支裝薄荷/爆珠，「薄荷幼」= 幼支薄荷/爆珠，「中關」= 中國內地品牌。
3. flag 係產品來源地嘅國旗 emoji（例如 🇭🇰 🇲🇴 🇯🇵 🇰🇷 🇨🇳）。
4. price 係港幣價錢（數字）。
5. **重要**：下面係現有產品清單。如果價單上嘅產品同現有產品係同一隻（即使寫法略有唔同），name 必須一字不差沿用現有名稱，cat 同 flag 亦沿用現有值。只有真係新嘅產品先至用新名。
6. 價單上睇唔清或者唔確定嘅項目都要輸出，揀最合理嘅解讀。

現有產品清單（格式：分類｜國旗｜名稱｜價錢）：
${currentNames || "（暫時無）"}`;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let message;
  try {
    message = await client.messages
      .stream({
        model: "claude-opus-4-8",
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        system,
        messages: [
          {
            role: "user",
            content: [
              ...blocks,
              { type: "text", text: "請解析呢份價單，輸出完整產品列表。" },
            ],
          },
        ],
        output_config: {
          format: { type: "json_schema", schema: PRODUCT_SCHEMA },
        },
      })
      .finalMessage();
  } catch (e) {
    return json({ error: `AI 解析失敗：${e.message || e}` }, 502);
  }

  if (message.stop_reason === "refusal") {
    return json({ error: "AI 拒絕處理呢個檔案，請試另一張圖" }, 502);
  }

  const textBlock = message.content.find((b) => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(textBlock?.text ?? "");
  } catch {
    return json({ error: "AI 回傳格式異常，請再試一次" }, 502);
  }
  const err = validateProducts(parsed.products);
  if (err) return json({ error: `解析結果唔合規：${err}` }, 502);

  return json({ products: parsed.products });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/products" && request.method === "GET") {
      return handleGetProducts(env);
    }
    if (url.pathname === "/api/products" && request.method === "POST") {
      return handleSaveProducts(request, env);
    }
    if (url.pathname === "/api/parse" && request.method === "POST") {
      return handleParse(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
};
