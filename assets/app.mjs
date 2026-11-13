import * as pdfjs from './pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', import.meta.url).href;

const api = window.editorAPI;
const byId = id => document.getElementById(id);
const recordsKey = 'cloud-classroom-documents-v1';
const rosterKey = 'cloud-classroom-roster-v1';
const exampleStudents = ['林伟杰','陈欣怡','黄子轩','李嘉恩','吴俊豪','张慧敏'];
let records = readJSON(recordsKey, []);
let roster = readJSON(rosterKey, exampleStudents);
let current = null, pageNumber = 1, pdf = null, renderTask = null;
let dbPromise;

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function persistRecords() { localStorage.setItem(recordsKey, JSON.stringify(records)); }
function updateRecordCount() {byId('recordCount').textContent = `${records.length + 4} 份 PDF（含 4 份示例）· 本机保存`}
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
function inkKey() { return `ink:${current?.id ?? current?.title}:${pageNumber}`; }
window.saveDocumentState = () => {
  if (!current) return Promise.resolve();
  const key = inkKey(), value = api.getStrokes();
  return put(key, value).catch(error => {api.toast('本机存储失败，请检查浏览器空间');throw error});
};

function updateRoster() {
  api.setStudents(roster);
  byId('rosterText').value = roster.join('\n');
  document.querySelector('.students-count').innerHTML = `${roster.length} <small>名学生</small>`;
  byId('wheelModal').querySelector('p').textContent = `从 ${roster.length} 名学生中抽选。`;
}
updateRoster();
function openRoster() { updateRoster(); api.openModal('#rosterModal'); }
for (const id of ['rosterNav','rosterOpen','quickRoster']) byId(id).onclick = openRoster;
byId('saveRoster').onclick = () => {
  const names = byId('rosterText').value.split(/\r?\n|，|,/).map(x => x.trim()).filter(Boolean);
  roster = [...new Set(names)];
  localStorage.setItem(rosterKey, JSON.stringify(roster));
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
  card.innerHTML = '<div class="doc-preview"><span class="pdf-badge">PDF</span><div class="page-mini"><div class="mini-title"></div><div class="mini-line"></div><div class="mini-line short"></div><div class="scribble"></div></div></div><div class="doc-body"><div class="doc-title-row"><div class="doc-title"></div><button class="more" title="资料选项">•••</button></div><div class="doc-meta"></div><div class="doc-footer"><button class="state"></button><button class="open-link">打开 ›</button></div></div>';
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
    persistRecords(); paintState(); api.toast(`已设为${record.status}`);
    if (current?.id === record.id) syncPermission();
  };
  card.querySelector('.more').onclick = event => { event.stopPropagation(); api.toast('资料选项将在后续版本加入'); };
  card.onclick = () => api.showEditor(record.title, record.id);
  document.querySelector('.document-grid').prepend(card);
}
records.forEach(makeCard);
updateRecordCount();

byId('pdfFile').onchange = async event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return api.toast('请选择 PDF 文件');
  if (file.size > 100 * 1024 * 1024) return api.toast('PDF 请小于 100 MB');
  const id = crypto.randomUUID();
  try {
    await put(`file:${id}`, file);
    const record = {id, title:file.name.replace(/\.pdf$/i, ''), pages:null, status:'草稿'};
    records.push(record); persistRecords(); makeCard(record); updateRecordCount();
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
  const visiblePdf = !!pdf;
  byId('pdfCanvas').style.display = visiblePdf ? 'block' : 'none';
  document.querySelector('.pdf-content').style.display = visiblePdf ? 'none' : 'block';
  byId('pageLabel').textContent = `${pageNumber} / ${pdf?.numPages || 1}`;
  document.querySelector('.file-name span').textContent = `初二华文 A 班 · 第 ${pageNumber} / ${pdf?.numPages || 1} 页`;
  if (!pdf) {
    const sheet = byId('pdfSheet');
    sheet.style.width = '';sheet.style.height = '';sheet.style.aspectRatio = '1.414 / 1';
    api.resize();return;
  }
  const page = await pdf.getPage(pageNumber), viewport = page.getViewport({scale:1});
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
  const canvas = byId('pdfCanvas');
  const scale = width / viewport.width, pixelRatio = window.devicePixelRatio || 1;
  const size = page.getViewport({scale:scale * pixelRatio});
  if (renderTask) {renderTask.cancel();try {await renderTask.promise} catch {}}
  canvas.width = Math.round(size.width);canvas.height = Math.round(size.height);
  renderTask = page.render({canvasContext:canvas.getContext('2d'),viewport:size});
  try {await renderTask.promise} catch(error) {if(error.name !== 'RenderingCancelledException')throw error}
}
async function loadInk() {
  try {api.setStrokes((await get(inkKey())) || []);} catch {api.setStrokes([])}
}
window.openDocument = async (title,id) => {
  current = (id && records.find(item => item.id === id)) || {title, status:'可修改'};
  pageNumber = 1;pdf = null;api.setStrokes([]);syncPermission();
  if (current.id) {
    try {
      const blob = await get(`file:${current.id}`);
      if (!blob) throw Error('文件不存在');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      pdf = await pdfjs.getDocument({data:bytes}).promise;
      if (current.pages !== pdf.numPages) {current.pages = pdf.numPages;persistRecords();document.querySelector(`[data-id="${current.id}"] .doc-meta`).textContent = `${pdf.numPages} 页 · 本机保存`;}
    } catch(error) {console.error(error);api.toast('PDF 无法读取，请重新上传')}
  }
  await renderPage();await loadInk();
};
async function changePage(delta) {
  if (!current) return;
  const next = Math.max(1,Math.min(pdf?.numPages || 1,pageNumber+delta));
  if (next === pageNumber) return;
  window.saveDocumentState();pageNumber = next;api.setStrokes([]);
  await renderPage();await loadInk();
}
byId('prevPage').onclick = () => changePage(-1);
byId('nextPage').onclick = () => changePage(1);
window.addEventListener('resize', () => {if (byId('editorView').style.display === 'block' && pdf) renderPage().catch(console.error)});
