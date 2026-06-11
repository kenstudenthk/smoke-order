const CATS = ["All",...new Set(BASE.map(p=>p.cat))];
const LS_KEY = "orderTabs_v3";

// ── STATE ──
let tabs = [];
let activeTabId = null;
let activeCat = "All";
let editingIndex = null;
let lastTotalQty = 0;

function freshItems(){
  return BASE.map(p=>({...p, checked:false, qty:1, oos:false}));
}

function newTab(name="Shop"){
  return {
    id: Date.now()+"_"+Math.random().toString(36).slice(2),
    name,
    items: freshItems(),
    discount:{type:"none", aX:"", aY:"", bX:"", bZ:"", bN:""}
  };
}

// ── PERSISTENCE ──
function save(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify({tabs, activeTabId})); }catch(e){}
}
function load(){
  try{
    const d = JSON.parse(localStorage.getItem(LS_KEY)||"null");
    if(d && d.tabs && d.tabs.length){
      tabs = d.tabs;
      // migrate: ensure all items exist
      tabs.forEach(t=>{
        const existing = new Map(t.items.map(i=>[i.name,i]));
        t.items = BASE.map(b=>{
          const ex = existing.get(b.name);
          return ex ? {...b, checked:ex.checked, qty:ex.qty, oos:ex.oos, price:ex.price} : {...b, checked:false, qty:1, oos:false};
        });
        if(!t.discount) t.discount={type:"none",aX:"",aY:"",bX:"",bZ:"",bN:""};
      });
      activeTabId = d.activeTabId && tabs.find(t=>t.id===d.activeTabId) ? d.activeTabId : tabs[0].id;
      return;
    }
  }catch(e){}
  const t = newTab("Shop 1");
  tabs = [t];
  activeTabId = t.id;
}

function getTab(id){ return tabs.find(t=>t.id===(id||activeTabId)); }
function curTab(){ return getTab(activeTabId); }

// ── TAB BAR ──
function renderTabBar(){
  const bar = document.getElementById("tabBar");
  bar.innerHTML = tabs.map(t=>`
    <div class="shop-tab ${t.id===activeTabId?'active':''}" onclick="switchTab('${t.id}')">
      <input class="tab-name-input" value="${esc(t.name)}" onclick="event.stopPropagation()"
        onchange="renameTab('${t.id}',this.value)" onblur="renameTab('${t.id}',this.value)" title="Click to rename">
      <button class="tab-close" onclick="event.stopPropagation();removeTab('${t.id}')" title="Remove tab">✕</button>
    </div>
  `).join("")+`<button class="add-tab-btn" onclick="addTab()" title="Add new shop tab">＋</button>`;
}

function switchTab(id){
  activeTabId = id;
  activeCat = "All";
  loadDiscountUI();
  renderTabBar();
  renderCatTabs();
  render();
  save();
}

function addTab(){
  const t = newTab("Shop "+(tabs.length+1));
  tabs.push(t);
  switchTab(t.id);
}

function removeTab(id){
  if(tabs.length===1){alert("Cannot remove the only tab.");return;}
  tabs = tabs.filter(t=>t.id!==id);
  if(activeTabId===id) activeTabId=tabs[0].id;
  switchTab(activeTabId);
}

function renameTab(id, name){
  const t = getTab(id);
  if(t){ t.name=name.trim()||"Shop"; save(); renderTabBar(); }
}

// ── CAT TABS ──
function renderCatTabs(){
  document.getElementById("catTabs").innerHTML=CATS.map(c=>
    `<div class="ctab ${c===activeCat?'active':''}" onclick="setCat('${c}')">${c}</div>`
  ).join("");
}
function setCat(c){
  activeCat=c; renderCatTabs(); render();
  const main = document.querySelector(".main");
  if(main){
    main.classList.remove("cat-flash");
    void main.offsetWidth; // restart animation
    main.classList.add("cat-flash");
  }
}

// ── DISCOUNT ──
function loadDiscountUI(){
  const d = curTab().discount;
  document.getElementById("discType").value = d.type||"none";
  document.getElementById("dA_x").value = d.aX||"";
  document.getElementById("dA_y").value = d.aY||"";
  document.getElementById("dB_x").value = d.bX||"";
  document.getElementById("dB_z").value = d.bZ||"";
  document.getElementById("dB_n").value = d.bN||"";
  toggleDiscRows(d.type);
  renderDiscPreview();
}

function toggleDiscRows(type){
  document.getElementById("discRowA").style.display = type==="a"?"flex":"none";
  document.getElementById("discRowB").style.display = type==="b"?"flex":"none";
}

function saveDiscount(){
  const type = document.getElementById("discType").value;
  toggleDiscRows(type);
  curTab().discount = {
    type, aX:document.getElementById("dA_x").value, aY:document.getElementById("dA_y").value,
    bX:document.getElementById("dB_x").value, bZ:document.getElementById("dB_z").value, bN:document.getElementById("dB_n").value
  };
  save(); render();
}

function calcDiscount(tab){
  const d = tab.discount;
  const items = tab.items.filter(i=>i.checked && !i.oos);
  const totalQty = items.reduce((a,i)=>a+i.qty,0);
  let discountAmt = 0;
  let note = "";
  if(d.type==="a"){
    const x=parseInt(d.aX), y=parseInt(d.aY);
    if(x>0 && y>0 && totalQty>=x){
      discountAmt = totalQty * y;
      note = `已套用規則A：${totalQty} 件 × -$${y} = -$${discountAmt}`;
    }
  } else if(d.type==="b"){
    const x=parseInt(d.bX), z=parseInt(d.bZ), n=parseInt(d.bN);
    if(x>0 && z>0 && n>0 && totalQty>=x){
      const freeItems = items.filter(i=>i.price<z).sort((a,b)=>b.price-a.price).slice(0,n);
      discountAmt = freeItems.reduce((a,i)=>a+i.price*Math.min(i.qty,1),0);
      note = `已套用規則B：${freeItems.length} 件 $${z} 以下貨品免費 → -$${discountAmt}`;
    }
  }
  return {discountAmt, note};
}

function renderDiscPreview(){
  const d = curTab().discount;
  const el = document.getElementById("discPreview");
  if(d.type==="none"){el.textContent="無啟用折扣。";return;}
  const {note} = calcDiscount(curTab());
  el.textContent = note || (d.type==="a"
    ? `規則A：購買 ≥ ${d.aX||"?"} 件 → 每件 -$${d.aY||"?"}`
    : `規則B：購買 ≥ ${d.bX||"?"} 件 → 免費贈送 ${d.bN||"?"} 件 $${d.bZ||"?"} 以下貨品`);
}

// ── RENDER TABLE ──
function render(){
  const tab = curTab();
  const q = document.getElementById("search").value.toLowerCase();
  const filtered = tab.items.map((p,i)=>({...p,i})).filter(p=>
    (activeCat==="All"||p.cat===activeCat) &&
    (p.name.toLowerCase().includes(q)||p.cat.toLowerCase().includes(q)||p.flag.includes(q))
  );
  const tbody = document.getElementById("tbody");
  if(!filtered.length){
    tbody.innerHTML=`<tr><td colspan="7" class="no-results">No results found</td></tr>`;
    updateSummary(); return;
  }
  const {discountAmt} = calcDiscount(tab);
  const totalQty = tab.items.filter(i=>i.checked&&!i.oos).reduce((a,i)=>a+i.qty,0);
  tbody.innerHTML = filtered.map(p=>{
    const unitDisc = tab.discount.type==="a" && parseInt(tab.discount.aX)>0 && totalQty>=parseInt(tab.discount.aX)
      ? parseInt(tab.discount.aY)||0 : 0;
    const effectivePrice = Math.max(0,(p.price||0)-unitDisc);
    const sub = p.checked && !p.oos ? p.qty*effectivePrice : 0;
    return `<tr class="${p.checked&&!p.oos?'row-selected':''} ${p.oos?'out-of-stock':''}">
      <td data-label=""><input type="checkbox" ${p.checked?'checked':''} ${p.oos?'disabled':''} onchange="toggle(${p.i},this.checked)"></td>
      <td data-label="Product">${p.flag} ${p.name} ${p.oos?'<span class="oos-badge">無貨</span>':''}</td>
      <td data-label="Cat"><span class="cat-badge cat-${p.cat}">${p.cat}</span></td>
      <td class="price-cell" data-label="Unit Price">
        ${unitDisc>0&&p.checked?`<span style="text-decoration:line-through;color:#666;font-size:11px">$${p.price}</span> `:``}
        $${effectivePrice}
      </td>
      <td data-label="Qty">
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty(${p.i},-1)" ${p.oos?'disabled':''}>−</button>
          <input class="qty-input" type="number" min="1" value="${p.qty}" onchange="setQty(${p.i},this.value)" ${p.oos?'disabled':''}>
          <button class="qty-btn" onclick="changeQty(${p.i},1)" ${p.oos?'disabled':''}>+</button>
        </div>
      </td>
      <td data-label="Subtotal" style="color:#a78bfa;font-weight:600">${p.checked&&!p.oos?'$'+sub:'—'}</td>
      <td data-label="Actions">
        <button class="btn btn-amber btn-sm" onclick="openEditPrice(${p.i})" style="margin-bottom:3px">✏️</button>
        <button class="btn ${p.oos?'btn-green':'btn-red'} btn-sm" onclick="toggleOos(${p.i})">${p.oos?'✅ 有貨':'🚫 無貨'}</button>
      </td>
    </tr>`;
  }).join("");
  updateSummary();
}

function updateSummary(){
  const tab = curTab();
  const sel = tab.items.filter(i=>i.checked&&!i.oos);
  const totalQty = sel.reduce((a,i)=>a+i.qty,0);
  const d = tab.discount;
  const unitDisc = d.type==="a" && parseInt(d.aX)>0 && totalQty>=parseInt(d.aX) ? parseInt(d.aY)||0 : 0;
  const rawTotal = sel.reduce((a,i)=>a+i.qty*(Math.max(0,i.price-unitDisc)),0);
  const {discountAmt, note} = calcDiscount(tab);
  const finalTotal = d.type==="b" ? Math.max(0,rawTotal-discountAmt) : rawTotal;
  document.getElementById("sumItems").textContent = sel.length;
  document.getElementById("sumQty").textContent = totalQty;
  document.getElementById("sumPrice").textContent = "$"+finalTotal;
  document.getElementById("discApplied").textContent = note;
  renderDiscPreview();

  // 🍄 1UP easter egg every 10 total items
  if(totalQty>0 && Math.floor(totalQty/10) > Math.floor(lastTotalQty/10)){
    const el = document.getElementById("oneUp");
    if(el){
      el.classList.remove("show");
      void el.offsetWidth; // restart animation
      el.classList.add("show");
    }
  }
  lastTotalQty = totalQty;
}

// ── ACTIONS ──
function toggle(i,v){ curTab().items[i].checked=v; save(); render(); }
function changeQty(i,d){ const t=curTab(); t.items[i].qty=Math.max(1,t.items[i].qty+d); save(); render(); }
function setQty(i,v){ curTab().items[i].qty=Math.max(1,parseInt(v)||1); save(); render(); }
function toggleOos(i){ const t=curTab(); t.items[i].oos=!t.items[i].oos; if(t.items[i].oos)t.items[i].checked=false; save(); render(); }
function clearAll(){
  curTab().items.forEach(i=>{i.checked=false;i.qty=1;});
  save(); render();
  const bg = document.querySelector(".pixel-bg");
  if(bg){
    bg.classList.add("frenzy");
    setTimeout(()=>bg.classList.remove("frenzy"),2500);
  }
}

// ── EDIT PRICE ──
function openEditPrice(i){
  editingIndex = i;
  const p = curTab().items[i];
  document.getElementById("editProductName").textContent = p.flag+" "+p.name;
  document.getElementById("editPriceInput").value = p.price;
  document.getElementById("editModal").classList.add("open");
  setTimeout(()=>document.getElementById("editPriceInput").focus(),50);
}
function confirmEditPrice(){
  const v = parseInt(document.getElementById("editPriceInput").value);
  if(isNaN(v)||v<0){alert("Invalid price");return;}
  curTab().items[editingIndex].price = v;
  save(); render();
  closeModal("editModal");
}

// ── SUMMARY MODAL ──
function openSummary(){
  const tab = curTab();
  const sel = tab.items.filter(i=>i.checked&&!i.oos);
  if(!sel.length){alert("No items selected.");return;}
  const d = tab.discount;
  const totalQty = sel.reduce((a,i)=>a+i.qty,0);
  const unitDisc = d.type==="a" && parseInt(d.aX)>0 && totalQty>=parseInt(d.aX) ? parseInt(d.aY)||0 : 0;
  const {discountAmt, note} = calcDiscount(tab);
  const rawTotal = sel.reduce((a,i)=>a+i.qty*(Math.max(0,i.price-unitDisc)),0);
  const finalTotal = d.type==="b" ? Math.max(0,rawTotal-discountAmt) : rawTotal;

  let lines = [`📋 ${tab.name} — Order Summary`, "─".repeat(32)];
  sel.forEach(i=>{
    const ep = Math.max(0,i.price-unitDisc);
    lines.push(`${i.flag} ${i.name}`);
    lines.push(`   Qty: ${i.qty}  ×  $${ep}  =  $${i.qty*ep}${unitDisc>0?` (原$${i.price}-$${unitDisc})`:"" }`);
  });
  lines.push("─".repeat(32));
  lines.push(`Total Items: ${sel.length}`);
  lines.push(`Total Qty:   ${totalQty}`);
  if(note) lines.push(`Discount:    ${note}`);
  lines.push(`Total Price: $${finalTotal}`);

  document.getElementById("summaryBody").textContent = lines.join("\n");
  document.getElementById("summaryModal").classList.add("open");
}
function copySummary(){
  const tab = curTab();
  const sel = tab.items.filter(i=>i.checked&&!i.oos);
  const txt = sel.map(i=>`${i.name} -- ${i.qty}條`).join("\n");
  navigator.clipboard.writeText(txt).then(()=>{
    const btn = document.querySelector("#summaryModal .btn-purple");
    btn.textContent="✅ Copied!"; setTimeout(()=>btn.textContent="📋 Copy",2000);
  });
}

// ── COPY FROM TAB MODAL ──
function openCopyModal(){
  const others = tabs.filter(t=>t.id!==activeTabId);
  if(!others.length){alert("No other tabs to copy from.");return;}
  const sel = document.getElementById("copyFromSelect");
  sel.innerHTML = others.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join("");
  document.getElementById("copyModal").classList.add("open");
}
function confirmCopy(){
  const fromId = document.getElementById("copyFromSelect").value;
  const from = getTab(fromId);
  const to = curTab();
  to.items.forEach((item,i)=>{
    item.checked = from.items[i]?.checked||false;
    item.qty = from.items[i]?.qty||1;
  });
  save(); render();
  closeModal("copyModal");
}

function closeModal(id){ document.getElementById(id).classList.remove("open"); }

// ── UTILS ──
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }

// ── INIT ──
load();
renderTabBar();
renderCatTabs();
loadDiscountUI();
render();

// close modals on overlay click
["summaryModal","editModal","copyModal"].forEach(id=>{
  document.getElementById(id).addEventListener("click",function(e){
    if(e.target===this) closeModal(id);
  });
});
