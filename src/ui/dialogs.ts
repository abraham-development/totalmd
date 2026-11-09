// Diálogos propios (HTML) y avisos breves.

export type UnsavedChoice = "save" | "discard" | "cancel";

function modal(content: HTMLElement, onEscape: () => void): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.append(content);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onEscape();
    }
  });
  document.body.append(overlay);
  return overlay;
}

/** Pregunta qué hacer con cambios sin guardar: Guardar / No guardar / Cancelar. */
export function askUnsaved(fileName: string): Promise<UnsavedChoice> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "alertdialog");
    box.innerHTML = `
      <h2>¿Guardar los cambios?</h2>
      <p></p>
      <div class="modal-actions">
        <button data-choice="discard" class="danger">No guardar</button>
        <span class="spacer"></span>
        <button data-choice="cancel">Cancelar</button>
        <button data-choice="save" class="primary">Guardar</button>
      </div>`;
    box.querySelector("p")!.textContent = `«${fileName}» tiene cambios que se perderán si no los guardas.`;
    const overlay = modal(box, () => done("cancel"));
    function done(choice: UnsavedChoice) {
      overlay.remove();
      resolve(choice);
    }
    box.addEventListener("click", (e) => {
      const choice = (e.target as HTMLElement).closest<HTMLElement>("[data-choice]")?.dataset.choice;
      if (choice) done(choice as UnsavedChoice);
    });
    box.querySelector<HTMLButtonElement>(".primary")!.focus();
  });
}

let toastTimer = 0;

export function toast(message: string, kind: "info" | "error" = "info"): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), kind === "error" ? 6000 : 2500);
}

/** Visor ampliado de un diagrama, con zoom (rueda) y desplazamiento (arrastrar). */
export function openDiagramViewer(svg: SVGSVGElement): void {
  const box = document.createElement("div");
  box.className = "diagram-viewer";
  box.tabIndex = -1;
  box.innerHTML = `
    <div class="viewer-bar">
      <span>Rueda: zoom · Arrastrar: mover · 0: reiniciar · Esc: cerrar</span>
      <button data-v="out" title="Alejar">−</button>
      <button data-v="reset" title="Ajustar">100%</button>
      <button data-v="in" title="Acercar">+</button>
      <button data-v="close" title="Cerrar">✕</button>
    </div>
    <div class="viewer-stage"><div class="viewer-content"></div></div>`;
  const content = box.querySelector<HTMLElement>(".viewer-content")!;
  const stage = box.querySelector<HTMLElement>(".viewer-stage")!;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.style.maxWidth = "none";
  content.append(clone);

  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => (content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`);
  const zoom = (factor: number, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) => {
    const next = Math.min(20, Math.max(0.1, scale * factor));
    x = cx - ((cx - x) * next) / scale;
    y = cy - ((cy - y) * next) / scale;
    scale = next;
    apply();
  };
  const fit = () => {
    const w = clone.viewBox.baseVal?.width || clone.getBoundingClientRect().width;
    const h = clone.viewBox.baseVal?.height || clone.getBoundingClientRect().height;
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    scale = Math.min((stage.clientWidth - 40) / w, (stage.clientHeight - 40) / h, 3);
    x = (stage.clientWidth - w * scale) / 2;
    y = (stage.clientHeight - h * scale) / 2;
    apply();
  };

  const overlay = modal(box, () => overlay.remove());
  overlay.classList.add("viewer-overlay");
  requestAnimationFrame(fit);
  box.focus();

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    const sx = e.clientX - x;
    const sy = e.clientY - y;
    const move = (ev: PointerEvent) => {
      x = ev.clientX - sx;
      y = ev.clientY - sy;
      apply();
    };
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", () => stage.removeEventListener("pointermove", move), { once: true });
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") zoom(1.2);
    else if (e.key === "-") zoom(1 / 1.2);
    else if (e.key === "0") fit();
  });
  box.querySelector(".viewer-bar")!.addEventListener("click", (e) => {
    const v = (e.target as HTMLElement).closest<HTMLElement>("[data-v]")?.dataset.v;
    if (v === "in") zoom(1.2);
    else if (v === "out") zoom(1 / 1.2);
    else if (v === "reset") fit();
    else if (v === "close") overlay.remove();
  });
}
