/** Screenshot annotation canvas: rectangle, arrow, pen, text, colour, undo. */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Tool = 'rect' | 'arrow' | 'pen' | 'text';

interface Point {
  x: number;
  y: number;
}

type Shape =
  | { tool: 'rect'; color: string; start: Point; end: Point }
  | { tool: 'arrow'; color: string; start: Point; end: Point }
  | { tool: 'pen'; color: string; points: Point[] }
  | { tool: 'text'; color: string; at: Point; text: string };

const COLORS = ['#e5484d', '#f0a020', '#30a46c', '#3b82f6', '#ffffff', '#111111'];

function drawShape(context: CanvasRenderingContext2D, shape: Shape): void {
  context.strokeStyle = shape.color;
  context.fillStyle = shape.color;
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (shape.tool === 'rect') {
    context.strokeRect(
      shape.start.x,
      shape.start.y,
      shape.end.x - shape.start.x,
      shape.end.y - shape.start.y,
    );
    return;
  }
  if (shape.tool === 'arrow') {
    const { start, end } = shape;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = 14;
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - head * Math.cos(angle - Math.PI / 6),
      end.y - head * Math.sin(angle - Math.PI / 6),
    );
    context.lineTo(
      end.x - head * Math.cos(angle + Math.PI / 6),
      end.y - head * Math.sin(angle + Math.PI / 6),
    );
    context.closePath();
    context.fill();
    return;
  }
  if (shape.tool === 'pen') {
    context.beginPath();
    shape.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
    return;
  }
  context.font = '600 20px ui-sans-serif, system-ui, sans-serif';
  context.fillText(shape.text, shape.at.x, shape.at.y);
}

export function Annotator({
  blob,
  onSave,
  onCancel,
}: {
  blob: Blob;
  onSave: (annotated: Blob) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>('rect');
  const [color, setColor] = useState(COLORS[0]!);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | undefined>(undefined);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
      }
      setReady(true);
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !image || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    for (const shape of shapes) drawShape(context, shape);
    if (draft) drawShape(context, draft);
  }, [shapes, draft]);

  useEffect(() => {
    if (ready) redraw();
  }, [ready, redraw]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const at = pointFromEvent(event);
    if (tool === 'text') {
      const text = window.prompt('Annotation text');
      if (text) setShapes((current) => [...current, { tool: 'text', color, at, text }]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft(
      tool === 'pen' ? { tool: 'pen', color, points: [at] } : { tool, color, start: at, end: at },
    );
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    const at = pointFromEvent(event);
    if (draft.tool === 'pen') setDraft({ ...draft, points: [...draft.points, at] });
    else if (draft.tool === 'rect' || draft.tool === 'arrow') setDraft({ ...draft, end: at });
  };

  const onPointerUp = () => {
    if (!draft) return;
    setShapes((current) => [...current, draft]);
    setDraft(undefined);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((result) => {
      if (result) onSave(result);
    }, 'image/png');
  };

  return (
    <div className="annotator">
      <div className="row" role="toolbar" aria-label="Annotation tools">
        {(['rect', 'arrow', 'pen', 'text'] as Tool[]).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={tool === item}
            className={tool === item ? 'primary' : ''}
            onClick={() => setTool(item)}
          >
            {item === 'rect'
              ? '▭ Box'
              : item === 'arrow'
                ? '➜ Arrow'
                : item === 'pen'
                  ? '✎ Pen'
                  : 'T Text'}
          </button>
        ))}
        {COLORS.map((item) => (
          <button
            key={item}
            type="button"
            aria-label={`Colour ${item}`}
            aria-pressed={color === item}
            className="swatch"
            style={{
              background: item,
              outline: color === item ? '2px solid var(--accent)' : 'none',
            }}
            onClick={() => setColor(item)}
          />
        ))}
        <button type="button" onClick={() => setShapes((current) => current.slice(0, -1))}>
          ↶ Undo
        </button>
        <button type="button" onClick={() => setShapes([])}>
          Clear
        </button>
        <button type="button" className="primary" onClick={save}>
          Save annotation
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="annotator-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
