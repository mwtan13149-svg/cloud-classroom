// Portable classroom backup: original PDFs plus roster, document order and ink.
export async function buildRoomBackup({room, get, Zip}) {
  const zip = new Zip();
  const manifest = {
    format:'cloud-classroom-room', version:1, createdAt:new Date().toISOString(),
    room:{name:room.name, roster:room.roster}, documents:[],
  };
  for (const record of room.records) {
    const blob = await get(`file:${record.id}`);
    if (!blob) throw Error(`缺少原 PDF：${record.title}`);
    const pdf = new Uint8Array(await blob.arrayBuffer());
    zip.file(`pdf/${record.id}.pdf`, pdf, {compression:'STORE'});
    const pageOrder = record.pageOrder || Array.from({length:record.pages || 0}, (_,index)=>index+1);
    const ink = [];
    for (const ref of pageOrder) {
      const value = await get(`ink:${record.id}:${typeof ref === 'number' ? ref : ref.id}`);
      if (value !== undefined && value !== null) ink.push({ref:typeof ref === 'number' ? ref : ref.id, value});
    }
    manifest.documents.push({id:record.id,title:record.title,status:record.status,pages:record.pages,pageOrder:record.pageOrder || null,ink});
  }
  zip.file('classroom.json', JSON.stringify(manifest));
  return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});
}

export async function readRoomBackup({file, Zip, createId}) {
  if (file.size > 500 * 1024 * 1024) throw Error('备份文件超过 500 MB');
  const zip = await Zip.loadAsync(file);
  const entry = zip.file('classroom.json');
  if (!entry || entry._data.uncompressedSize > 100 * 1024 * 1024) throw Error('备份结构不正确');
  let manifest;
  try {manifest=JSON.parse(await entry.async('string'))} catch {throw Error('备份说明无法读取')}
  if (manifest?.format !== 'cloud-classroom-room' || manifest.version !== 1 || !Array.isArray(manifest.documents) || manifest.documents.length > 300 || !Array.isArray(manifest.room?.roster)) throw Error('不是兼容的课室备份');
  const name=String(manifest.room.name || '').trim().slice(0,60);
  if (!name) throw Error('备份缺少课室名称');
  const roster=manifest.room.roster.filter(item=>typeof item==='string').map(item=>item.trim().slice(0,120)).filter(Boolean).slice(0,300);
  const documents=[];
  for (const item of manifest.documents) {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id)) throw Error('备份中的 PDF 标识无效');
    const pdfEntry=zip.file(`pdf/${item.id}.pdf`);
    if (!pdfEntry || pdfEntry._data.uncompressedSize > 100 * 1024 * 1024) throw Error(`缺少原 PDF：${item.title || item.id}`);
    const bytes=await pdfEntry.async('uint8array');
    if (bytes.length<8 || String.fromCharCode(...bytes.slice(0,4))!=='%PDF') throw Error(`PDF 文件无效：${item.title || item.id}`);
    const id=createId();
    const oldOrder=Array.isArray(item.pageOrder) ? item.pageOrder : null;
    const blankIds=new Map();
    const pageOrder=oldOrder?.map(ref=>{
      if (Number.isInteger(ref) && ref>0) return ref;
      if (!ref || typeof ref.id!=='string' || !Number.isInteger(ref.base) || ref.base<1) throw Error('备份中的空白页无效');
      const newId=`blank-${createId()}`;blankIds.set(ref.id,newId);return {id:newId,base:ref.base};
    });
    const inks=[];
    for (const ink of Array.isArray(item.ink) ? item.ink : []) {
      const ref=typeof ink.ref==='number' ? ink.ref : blankIds.get(ink.ref);
      if (ref === undefined) continue;
      if (!Array.isArray(ink.value) && !Array.isArray(ink.value?.strokes)) throw Error('备份中的笔迹无效');
      inks.push({key:`ink:${id}:${ref}`,value:ink.value});
    }
    documents.push({
      record:{id,title:String(item.title || '未命名 PDF').trim().slice(0,120),status:['草稿','锁定','可修改'].includes(item.status)?item.status:'草稿',pages:pageOrder?.length || (Number.isInteger(item.pages)?item.pages:null),...(pageOrder?{pageOrder}:{})},
      pdf:new Blob([bytes],{type:'application/pdf'}),inks,
    });
  }
  return {name,roster,documents};
}
