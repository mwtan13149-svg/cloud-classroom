// Keep the source PDF as vector pages, then add vector ink on top.
export async function buildAnnotatedPdf({sourceBytes, pageOrder, loadInk, getViewport, lib}) {
  const source = await lib.PDFDocument.load(sourceBytes);
  const output = await lib.PDFDocument.create();
  const originalRefs = pageOrder.filter(ref => typeof ref === 'number');
  const copied = await output.copyPages(source, originalRefs.map(ref => ref - 1));
  let copiedIndex = 0;

  for (const ref of pageOrder) {
    const sourcePage = typeof ref === 'number' ? ref : ref.base;
    const viewport = await getViewport(sourcePage);
    const page = typeof ref === 'number'
      ? output.addPage(copied[copiedIndex++])
      : output.addPage([viewport.width, viewport.height]);
    const ink = await loadInk(ref, viewport);
    if (!ink?.strokes?.length) continue;
    const displayWidth = ink.width || viewport.width;
    const displayHeight = ink.height || viewport.height;
    const scale = Math.min(viewport.width / displayWidth, viewport.height / displayHeight);
    const toPdfPoint = typeof ref === 'number'
      ? point => {
          const [x, y] = viewport.convertToPdfPoint(point.x * viewport.width / displayWidth, point.y * viewport.height / displayHeight);
          return {x, y};
        }
      : point => ({x: point.x * viewport.width / displayWidth, y: viewport.height - point.y * viewport.height / displayHeight});

    for (const stroke of ink.strokes) {
      const points = thinPoints(stroke.points || []);
      if (!points.length) continue;
      const color = parseColor(stroke.color, lib);
      const opacity = stroke.kind === 'highlighter' ? .3 : 1;
      const thickness = Math.max(.45, (Number(stroke.size) || 4) * (stroke.kind === 'highlighter' ? 4 : 1) * scale);
      const options = {thickness, color, opacity, lineCap: lib.LineCapStyle.Round};
      if (points.length === 1) {
        const p = toPdfPoint(points[0]);
        page.drawLine({...options, start:p, end:{x:p.x+.01,y:p.y+.01}});
      } else if (stroke.kind === 'highlighter') {
        // Stroke the whole translucent path once so joined segments do not darken each other.
        const path = points.map((point, index) => {
          const p = toPdfPoint(point);
          return `${index ? 'L' : 'M'} ${p.x.toFixed(3)} ${(-p.y).toFixed(3)}`;
        }).join(' ');
        page.drawSvgPath(path, {
          x:0, y:0, borderColor:color, borderWidth:thickness,
          borderOpacity:opacity, borderLineCap:lib.LineCapStyle.Round,
        });
      } else {
        for (let i = 1; i < points.length; i++) {
          page.drawLine({...options, start:toPdfPoint(points[i-1]), end:toPdfPoint(points[i])});
        }
      }
    }
  }
  return output.save();
}

function thinPoints(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = result[result.length - 1], point = points[i];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= .8) result.push(point);
  }
  result.push(points[points.length - 1]);
  return result;
}

function parseColor(hex, lib) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!match) return lib.rgb(0, 0, 0);
  const value = match[1];
  return lib.rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
}
