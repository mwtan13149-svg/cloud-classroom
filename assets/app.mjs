import * as pdfjs from './pdf.mjs';
import { buildAnnotatedPdf } from './export.mjs';
import { buildRoomBackup, readRoomBackup } from './backup.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', import.meta.url).href;

const api = window.editorAPI;
const byId = id => document.getElementById(id);
const recordsKey = 'cloud-classroom-documents-v1';
const rosterKey = 'cloud-classroom-roster-v1';
const roomsKey = 'cloud-classroom-rooms-v1';
const selectedRoomKey = 'cloud-classroom-selected-room-v1';
const exampleStudents = ['林伟杰','陈欣怡','黄子轩','李嘉恩','吴俊豪','张慧敏'];
let rooms = readJSON(roomsKey, null);
if (!Array.isArray(rooms) || !rooms.length) {
  rooms = [{id:crypto.randomUUID(), name:'初二华文 A 班', roster:readJSON(rosterKey, exampleStudents), records:readJSON(recordsKey, [])}];
  localStorage.setItem(roomsKey, JSON.stringify(rooms));
}
let room = rooms.find(item => item.id === localStorage.getItem(selectedRoomKey)) || rooms[0];
let records = room.records, roster = room.roster;
let current = null, pageNumber = 1, pageOrder = [1], pdf = null, renderTask = null;
let dbPromise, pdfLibPromise, zipPromise, activeFilter = '全部', selectedDoc = null;

function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLibPromise) pdfLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./pdf-lib.min.js', import.meta.url).href;
    script.onload = () => window.PDFLib ? resolve(window.PDFLib) : reject(Error('PDF 导出组件未载入'));
    script.onerror = () => reject(Error('PDF 导出组件下载失败，请检查网络'));
    document.head.append(script);
  }).catch(error => {pdfLibPromise = null;throw error});
  return pdfLibPromise;
}

function loadZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!zipPromise) zipPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./jszip.min.js', import.meta.url).href;
    script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(Error('备份组件未载入'));
    script.onerror = () => reject(Error('备份组件下载失败，请检查网络'));
    document.head.append(script);
  }).catch(error => {zipPromise = null;throw error});
  return zipPromise;
}

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function persistRooms() { localStorage.setItem(roomsKey, JSON.stringify(rooms)); }
function persistRecords() { room.records = records; persistRooms(); }
function updateRecordCount() {byId('recordCount').textContent = `${records.length} 份 PDF · 本机保存`}
function openDB() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('cloud-classroom-prototype', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('items');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
async function put(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    tx.objectStore('items').put(value, key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function get(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readonly');
    const request = tx.objectStore('items').get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function remove(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    tx.objectStore('items').delete(key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
function pageRef() { return pageOrder[pageNumber - 1] ?? 1; }
function inkKeyFor(ref, document = current) {
  return `ink:${document?.id ?? document?.title}:${typeof ref === 'number' ? ref : ref.id}`;
}
function inkKey() {
  const ref = pageRef();
  return inkKeyFor(ref);
}
function sampleOrderKey() { return `cloud-classroom-sample-pages-v1:${current.title}`; }
function persistPageOrder() {
  if (current.id) {
    current.pageOrder = pageOrder;
    current.pages = pageOrder.length;
    persistRecords();
    const meta = document.querySelector(`[data-id="${current.id}"] .doc-meta`);
    if (meta) meta.textContent = `${pageOrder.length} 页 · 本机保存`;
  } else {
    localStorage.setItem(sampleOrderKey(), JSON.stringify(pageOrder));
  }
}
window.saveDocumentState = () => {
  if (!current) return Promise.resolve();
  const key = inkKey(), canvas = byId('drawCanvas');
  const value = {width:canvas.clientWidth, height:canvas.clientHeight, strokes:api.getStrokes()};
  return put(key, value).catch(error => {api.toast('本机存储失败，请检查浏览器空间');throw error});
};

function updateRoster() {
  api.setStudents(roster);
  byId('rosterText').value = roster.join('\n');
  document.querySelector('.students-count').innerHTML = `${roster.length} <small>名学生</small>`;
  const faces = document.querySelector('.faces');
  faces.replaceChildren();
  roster.slice(0, 5).forEach(name => {
    const face = document.createElement('div');face.className = 'face';face.textContent = name.slice(0, 1);faces.append(face);
  });
  if (roster.length > 5) {const extra = document.createElement('div');extra.className='face';extra.textContent=`+${roster.length-5}`;faces.append(extra)}
  byId('wheelModal').querySelector('p').textContent = `从 ${roster.length} 名学生中抽选。`;
}
updateRoster();

function updateRoomLabels() {
  for (const id of ['roomSwitchName','roomCrumb','roomHeroName']) byId(id).textContent = room.name;
  byId('roomInitial').textContent = room.name.slice(0, 1);
  updateRoster();updateRecordCount();
}
function renderRoomList() {
  const list = byId('roomList');list.replaceChildren();
  rooms.forEach(item => {
    const button = document.createElement('button');button.type='button';button.className='room-row' + (item.id === room.id ? ' active' : '');
    const badge = document.createElement('span');badge.className='room-badge';badge.textContent=item.name.slice(0,1);
    const label = document.createElement('span');const title=document.createElement('b');title.textContent=item.name;
    const detail=document.createElement('small');detail.textContent=`${item.records.length} 份 PDF · ${item.roster.length} 名学生`;
    label.append(title,detail);button.append(badge,label);
    button.onclick=()=>switchRoom(item.id);list.append(button);
  });
}
function openRooms() {renderRoomList();byId('roomStatus').textContent='';api.openModal('#roomModal')}
for (const id of ['roomSwitch','mobileRoomSwitch']) byId(id).onclick=openRooms;
byId('topBackup').onclick=openRooms;
function switchRoom(id) {
  const target=rooms.find(item=>item.id===id);if(!target)return;
  room=target;records=room.records;roster=room.roster;current=null;pdf=null;
  localStorage.setItem(selectedRoomKey, room.id);
  byId('docSearch').value='';activeFilter='全部';
  document.querySelectorAll('.chip[data-filter]').forEach(button=>button.classList.toggle('active',button.dataset.filter==='全部'));
  updateRoomLabels();renderDocuments();api.closeModals();api.toast(`已切换到${room.name}`);
}
byId('createRoom').onclick=()=>{
  const name=byId('newRoomName').value.trim();
  if(!name)return api.toast('请先输入课室名称');
  if(rooms.some(item=>item.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return api.toast('已有同名课室');
  const created={id:crypto.randomUUID(),name,roster:[],records:[]};rooms.push(created);persistRooms();
  byId('newRoomName').value='';switchRoom(created.id);
};
byId('newRoomName').onkeydown=event=>{if(event.key==='Enter')byId('createRoom').click()};
byId('backupRoom').onclick=async()=>{
  const button=byId('backupRoom'),status=byId('roomStatus');button.disabled=true;status.textContent='正在打包原 PDF、名单和笔迹…';
  try {
    const Zip=await loadZip();
    const blob=await buildRoomBackup({room,get,Zip});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`${room.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}-课室备份-${new Date().toISOString().slice(0,10)}.zip`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    status.textContent=`备份已下载：${room.records.length} 份 PDF、${room.roster.length} 名学生。请把 ZIP 保存在安全位置。`;
  } catch(error) {console.error(error);status.textContent=`备份失败：${error.message || '请检查本机空间'}`}
  finally {button.disabled=false}
};
byId('restoreRoom').onclick=()=>byId('backupFile').click();
byId('backupFile').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  const button=byId('restoreRoom'),status=byId('roomStatus');button.disabled=true;status.textContent='正在检查备份并建立新课室…';
  const written=[];let created=null;
  try {
    const Zip=await loadZip();
    const data=await readRoomBackup({file,Zip,createId:()=>crypto.randomUUID()});
    let name=data.name,n=2;
    while(rooms.some(item=>item.name.toLocaleLowerCase()===name.toLocaleLowerCase()))name=`${data.name}（导入 ${n++}）`;
    created={id:crypto.randomUUID(),name,roster:data.roster,records:data.documents.map(item=>item.record)};
    for(const item of data.documents){
      const key=`file:${item.record.id}`;await put(key,item.pdf);written.push(key);
      for(const ink of item.inks){await put(ink.key,ink.value);written.push(ink.key)}
    }
    rooms.push(created);persistRooms();switchRoom(created.id);
    api.toast(`已还原${created.name}：${created.records.length} 份 PDF`);
  } catch(error) {
    console.error(error);
    if(created)rooms=rooms.filter(item=>item.id!==created.id);
    for(const key of written)await remove(key).catch(console.error);
    status.textContent=`导入失败：${error.message || '请检查备份文件和浏览器空间'}`;
  } finally {button.disabled=false;event.target.value=''}
};
function openRoster() { updateRoster(); api.openModal('#rosterModal'); }
for (const id of ['rosterNav','rosterOpen','quickRoster']) byId(id).onclick = openRoster;
byId('saveRoster').onclick = () => {
  const names = byId('rosterText').value.split(/\r?\n|，|,/).map(x => x.trim()).filter(Boolean);
  roster = [...new Set(names)];
  room.roster=roster;persistRooms();
  updateRoster(); api.closeModals(); api.toast(`已保存 ${roster.length} 名学生`);
};
byId('importRoster').onclick = () => byId('rosterFile').click();
byId('rosterFile').onchange = async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const text = (await file.text()).replace(/^\uFEFF/, '');
  const rows = text.split(/\r?\n/).map(row => row.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))).filter(row => row.some(Boolean));
  const header = rows[0]?.findIndex(cell => /^(姓名|name|student name)$/i.test(cell)) ?? -1;
  const names = rows.slice(header >= 0 ? 1 : 0).map(row => row[Math.max(header, 0)]).filter(Boolean);
  byId('rosterText').value = names.join('\n');
  api.toast(`已读取 ${names.length} 个名字，请检查后保存`);
};

function makeCard(record) {
  const card = document.createElement('article'); card.className = 'doc-card';
  card.dataset.title = record.title; card.dataset.id = record.id;
  card.innerHTML = '<div class="doc-preview"><span class="pdf-badge">PDF</span><div class="page-mini"><div class="mini-title"></div><div class="mini-line"></div><div class="mini-line short"></div><div class="scribble"></div></div></div><div class="doc-body"><div class="doc-title-row"><div class="doc-title"></div><button class="more" title="资料选项" aria-label="管理 PDF">•••</button></div><div class="doc-meta"></div><div class="doc-footer"><button class="state"></button><button class="open-link">打开 ›</button></div></div><div class="doc-menu"><button data-action="rename">更改名称</button><button data-action="up">上移</button><button data-action="down">下移</button><button data-action="delete" class="danger">删除资料</button></div>';
  card.querySelector('.doc-title').textContent = record.title;
  card.querySelector('.doc-meta').textContent = `${record.pages || '—'} 页 · 本机保存`;
  const state = card.querySelector('.state');
  function paintState() {
    state.className = 'state ' + (record.status === '可修改' ? 'editable' : record.status === '锁定' ? 'locked' : 'draft');
    state.textContent = record.status === '可修改' ? '✎ 访客可修改' : record.status === '锁定' ? '▣ 已锁定' : '● 草稿';
  }
  paintState();
  state.onclick = event => {
    event.stopPropagation();
    record.status = record.status === '草稿' ? '可修改' : record.status === '可修改' ? '锁定' : '可修改';
    persistRecords(); paintState(); applyDocumentFilter(); api.toast(`已设为${record.status}`);
    if (current?.id === record.id) syncPermission();
  };
  card.querySelector('.more').onclick = event => {
    event.stopPropagation();document.querySelectorAll('.doc-menu.show').forEach(menu=>{if(menu!==card.querySelector('.doc-menu'))menu.classList.remove('show')});
    card.querySelector('.doc-menu').classList.toggle('show');
  };
  card.querySelectorAll('.doc-menu button').forEach(button=>button.onclick=event=>{
    event.stopPropagation();card.querySelector('.doc-menu').classList.remove('show');
    const action=button.dataset.action;
    if(action==='rename'){selectedDoc=record;byId('docNameInput').value=record.title;api.openModal('#renameDocModal');byId('docNameInput').focus()}
    else if(action==='delete'){selectedDoc=record;byId('deleteDocMessage').textContent=`删除「${record.title}」及所有笔迹？此操作无法撤销，请先备份课室。`;api.openModal('#deleteDocModal')}
    else {const index=records.indexOf(record),other=index+(action==='up'?-1:1);if(other>=0&&other<records.length){[records[index],records[other]]=[records[other],records[index]];persistRecords();renderDocuments()}}
  });
  card.onclick = () => api.showEditor(record.title, record.id);
  document.querySelector('.document-grid').append(card);
}
function applyDocumentFilter() {
  const term=byId('docSearch').value.trim().toLocaleLowerCase();let shown=0;
  document.querySelectorAll('.document-grid > .doc-card').forEach(card=>{
    const record=records.find(item=>item.id===card.dataset.id);
    const visible=!!record && (activeFilter==='全部'||record.status===activeFilter) && record.title.toLocaleLowerCase().includes(term);
    card.hidden=!visible;if(visible)shown++;
  });
  byId('emptyDocuments').hidden=shown>0;
  byId('emptyDocuments').textContent=records.length ? '没有符合条件的 PDF。' : '这间课室还没有 PDF，点击「上传 PDF」开始。';
}
function renderDocuments() {
  const grid=document.querySelector('.document-grid');grid.replaceChildren();
  records.forEach(makeCard);
  const empty=document.createElement('div');empty.id='emptyDocuments';empty.className='empty-docs';grid.append(empty);
  updateRecordCount();applyDocumentFilter();
}
document.querySelectorAll('.chip[data-filter]').forEach(button=>button.onclick=()=>{
  activeFilter=button.dataset.filter;
  document.querySelectorAll('.chip[data-filter]').forEach(item=>item.classList.toggle('active',item===button));
  applyDocumentFilter();
});
byId('docSearch').oninput=applyDocumentFilter;
byId('saveDocName').onclick=()=>{
  if(!selectedDoc)return;const name=byId('docNameInput').value.trim();if(!name)return api.toast('请输入 PDF 名称');
  selectedDoc.title=name;persistRecords();
  if(current?.id===selectedDoc.id){current.title=name;byId('editorTitle').textContent=name}
  renderDocuments();api.closeModals();api.toast('PDF 已改名');selectedDoc=null;
};
byId('docNameInput').onkeydown=event=>{if(event.key==='Enter')byId('saveDocName').click()};
byId('confirmDeleteDoc').onclick=async()=>{
  if(!selectedDoc)return;const record=selectedDoc;const button=byId('confirmDeleteDoc');button.disabled=true;
  try {
    await remove(`file:${record.id}`);
    for(const ref of record.pageOrder||[]) await remove(inkKeyFor(ref,record));
    records=records.filter(item=>item.id!==record.id);room.records=records;persistRooms();
    renderDocuments();api.closeModals();api.toast('PDF 与笔迹已删除');selectedDoc=null;
  }catch(error){console.error(error);api.toast('删除失败，请重试')}
  finally{button.disabled=false}
};
updateRoomLabels();renderDocuments();
document.addEventListener('click',event=>{if(!event.target.closest('.more,.doc-menu'))document.querySelectorAll('.doc-menu.show').forEach(menu=>menu.classList.remove('show'))});

byId('pdfFile').onchange = async event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return api.toast('请选择 PDF 文件');
  if (file.size > 100 * 1024 * 1024) return api.toast('PDF 请小于 100 MB');
  const id = crypto.randomUUID();
  try {
    await put(`file:${id}`, file);
    const record = {id, title:file.name.replace(/\.pdf$/i, ''), pages:null, status:'草稿'};
    records.push(record); persistRecords(); renderDocuments();
    api.closeModals(); api.toast('PDF 已保存为草稿');
    event.target.value = '';
  } catch (error) { console.error(error); api.toast('PDF 未保存成功，请检查浏览器空间'); }
};

function syncPermission() {
  const value = current?.status === '锁定' ? '▣ 锁定' : current?.status === '草稿' ? '● 草稿／隐藏' : '✎ 访客可修改';
  byId('permission').value = value;
}
byId('permission').onchange = event => {
  if (!current) return;
  current.status = event.target.value.includes('锁定') ? '锁定' : event.target.value.includes('草稿') ? '草稿' : '可修改';
  const record = records.find(item => item.id === current.id);
  if (record) {record.status = current.status; persistRecords(); document.querySelector(`[data-id="${record.id}"] .state`).textContent = current.status === '锁定' ? '▣ 已锁定' : current.status === '草稿' ? '● 草稿' : '✎ 访客可修改'; document.querySelector(`[data-id="${record.id}"] .state`).className = 'state ' + (current.status === '锁定' ? 'locked' : current.status === '草稿' ? 'draft' : 'editable');}
  api.toast(`文档已设为${current.status}`);
};

async function renderPage() {
  const ref = pageRef();
  const visiblePdf = !!pdf && typeof ref === 'number';
  byId('pdfCanvas').style.display = visiblePdf ? 'block' : 'none';
  document.querySelector('.pdf-content').style.display = !pdf && typeof ref === 'number' ? 'block' : 'none';
  byId('pageLabel').textContent = `${pageNumber} / ${pageOrder.length}`;
  document.querySelector('.file-name span').textContent = `${room.name} · 第 ${pageNumber} / ${pageOrder.length} 页${typeof ref === 'number' ? '' : ' · 空白页'}`;
  byId('deleteBlankPage').disabled = typeof ref === 'number';
  if (!pdf) {
    const sheet = byId('pdfSheet');
    sheet.style.width = '';sheet.style.height = '';sheet.style.aspectRatio = '1.414 / 1';
    api.resize();return;
  }
  const page = await pdf.getPage(typeof ref === 'number' ? ref : ref.base), viewport = page.getViewport({scale:1});
  const sheet = byId('pdfSheet'), stage = byId('canvasStage');
  // PDF.js reports page dimensions in points. 96 / 72 maps them to CSS pixels.
  // When the display is smaller, reduce both dimensions by the same factor.
  const naturalWidth = viewport.width * 96 / 72;
  const availableWidth = Math.max(220, stage.clientWidth - (window.innerWidth <= 760 ? 24 : 72));
  const width = Math.min(naturalWidth, availableWidth);
  const height = width * viewport.height / viewport.width;
  sheet.style.width = `${width}px`;
  sheet.style.height = `${height}px`;
  sheet.style.aspectRatio = 'auto';
  api.resize();
  if (!visiblePdf) return;
  const canvas = byId('pdfCanvas');
  const scale = width / viewport.width, pixelRatio = window.devicePixelRatio || 1;
  const size = page.getViewport({scale:scale * pixelRatio});
  if (renderTask) {renderTask.cancel();try {await renderTask.promise} catch {}}
  canvas.width = Math.round(size.width);canvas.height = Math.round(size.height);
  renderTask = page.render({canvasContext:canvas.getContext('2d'),viewport:size});
  try {await renderTask.promise} catch(error) {if(error.name !== 'RenderingCancelledException')throw error}
}
async function loadInk() {
  try {
    const saved = await get(inkKey());
    if (Array.isArray(saved)) return api.setStrokes(saved);
    const width = byId('pdfSheet').clientWidth, height = byId('pdfSheet').clientHeight;
    const strokes = (saved?.strokes || []).map(stroke => ({...stroke, points:stroke.points.map(point => ({x:point.x * width / (saved.width || width), y:point.y * height / (saved.height || height)}))}));
    api.setStrokes(strokes);
  } catch {api.setStrokes([])}
}
window.openDocument = async (title,id) => {
  current = (id && records.find(item => item.id === id)) || {title, status:'可修改'};
  pageNumber = 1;pageOrder = [1];pdf = null;api.setStrokes([]);syncPermission();
  if (current.id) {
    try {
      const blob = await get(`file:${current.id}`);
      if (!blob) throw Error('文件不存在');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      pdf = await pdfjs.getDocument({data:bytes}).promise;
      pageOrder = Array.isArray(current.pageOrder) && current.pageOrder.length
        ? current.pageOrder : Array.from({length:pdf.numPages},(_,index)=>index+1);
      if (current.pages !== pageOrder.length) persistPageOrder();
    } catch(error) {console.error(error);api.toast('PDF 无法读取，请重新上传')}
  } else {
    pageOrder = readJSON(sampleOrderKey(), [1]);
  }
  await renderPage();await loadInk();
};
async function changePage(delta) {
  if (!current) return;
  const next = Math.max(1,Math.min(pageOrder.length,pageNumber+delta));
  if (next === pageNumber) return;
  await window.saveDocumentState();pageNumber = next;api.setStrokes([]);
  await renderPage();await loadInk();
}
byId('prevPage').onclick = () => changePage(-1);
byId('nextPage').onclick = () => changePage(1);
byId('addBlankPage').onclick = async () => {
  if (!current) return;
  await window.saveDocumentState();
  const ref = pageRef();
  const base = typeof ref === 'number' ? ref : ref.base;
  pageOrder.splice(pageNumber, 0, {id:`blank-${crypto.randomUUID()}`, base});
  persistPageOrder();
  pageNumber += 1;
  api.setStrokes([]);
  await renderPage();
  await loadInk();
  api.toast('已在当前页后插入空白页');
};
byId('deleteBlankPage').onclick = async () => {
  const ref = pageRef();
  if (!current || typeof ref === 'number') return;
  if (!window.confirm('删除这张空白页及其笔迹？')) return;
  await remove(inkKey());
  pageOrder.splice(pageNumber - 1, 1);
  pageNumber = Math.min(pageNumber, pageOrder.length);
  persistPageOrder();
  api.setStrokes([]);
  await renderPage();
  await loadInk();
  api.toast('空白页已删除');
};

byId('exportBtn').onclick = () => {
  const available = !!current?.id && !!pdf;
  byId('downloadPdf').disabled = !available;
  byId('exportStatus').textContent = available
    ? `准备导出「${current.title}」，共 ${pageOrder.length} 页。下载后可打开 Google Classroom 或 Drive 上传。`
    : '示例页面不是真实 PDF。请先上传自己的 PDF，再下载带笔迹的版本。';
  api.openModal('#exportModal');
};
byId('downloadPdf').onclick = async () => {
  if (!current?.id || !pdf) return;
  const button = byId('downloadPdf'), status = byId('exportStatus');
  button.disabled = true;button.textContent = '正在合成 PDF…';status.textContent = '正在合成原 PDF、空白页和笔迹，请稍候。';
  try {
    await window.saveDocumentState();
    const record = current, order = [...pageOrder], viewer = pdf;
    const blob = await get(`file:${record.id}`);
    if (!blob) throw Error('原 PDF 已不在此浏览器中');
    const pdfLib = await loadPdfLib();
    const stage = byId('canvasStage');
    const bytes = await buildAnnotatedPdf({
      sourceBytes:new Uint8Array(await blob.arrayBuffer()),
      pageOrder:order,
      lib:pdfLib,
      getViewport:async number => (await viewer.getPage(number)).getViewport({scale:1}),
      loadInk:async (ref, viewport) => {
        const saved = await get(inkKeyFor(ref, record));
        if (!Array.isArray(saved)) return saved;
        const width = Math.min(viewport.width * 96 / 72, Math.max(220, stage.clientWidth - (window.innerWidth <= 760 ? 24 : 72)));
        return {width, height:width * viewport.height / viewport.width, strokes:saved};
      },
    });
    const url = URL.createObjectURL(new Blob([bytes], {type:'application/pdf'}));
    const link = document.createElement('a');
    link.href = url;link.download = `${record.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}-课堂笔记.pdf`;
    document.body.append(link);link.click();link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = `已下载 ${order.length} 页 PDF。现在可点「打开 Google Classroom」上传到课室资料。`;
    api.toast('课堂笔记 PDF 已下载');
  } catch (error) {
    console.error(error);
    status.textContent = `导出失败：${error.message || '请检查原 PDF 与本机空间'}`;
  } finally {button.disabled = false;button.textContent = '⇩ 下载带笔迹 PDF';}
};
window.addEventListener('resize', () => {if (byId('editorView').style.display === 'block' && pdf) renderPage().catch(console.error)});
