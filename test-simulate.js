setTimeout(() => {
  console.warn("Starting test simulation");
  const canvas = document.getElementById("scene");
  canvas.setPointerCapture = function() {};
  canvas.releasePointerCapture = function() {};
  
  // Left drag to create crease
  canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 400, clientY: 400, isPrimary: true }));
  canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, button: -1, clientX: 600, clientY: 400, isPrimary: true }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0, clientX: 600, clientY: 400, isPrimary: true }));
  
  console.warn("Crease drawn");
  
  setTimeout(() => {
    // Right drag to fold
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, button: 2, clientX: 500, clientY: 450, isPrimary: true }));
    canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 2, button: -1, clientX: 500, clientY: 300, isPrimary: true }));
    
    setTimeout(() => {
        canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, button: 2, clientX: 500, clientY: 300, isPrimary: true }));
        console.warn("Fold completed");
    }, 500);
  }, 500);
}, 2000);
