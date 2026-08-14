(function () {
  var script = document.currentScript;
  var origin = new URL(script.src).origin;
  var mounted = false;

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Abrir asistente');
  button.style.cssText = [
    'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483000',
    'border:0', 'padding:0', 'cursor:pointer',
    'width:56px', 'height:56px', 'border-radius:9999px',
    'background:#0c1f1a', 'display:flex', 'align-items:center', 'justify-content:center',
    'box-shadow:0 4px 20px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08)'
  ].join(';');
  button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5dc4a4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  var frame = document.createElement('iframe');
  frame.src = origin + '/widget';
  frame.title = 'Asistente';
  frame.setAttribute('allow', 'clipboard-write');
  frame.style.cssText = [
    'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483000',
    'width:min(400px,calc(100vw - 32px))', 'height:min(600px,calc(100vh - 48px))',
    'border:0', 'border-radius:20px', 'display:none',
    'box-shadow:0 24px 60px rgba(0,0,0,.45)', 'color-scheme:normal'
  ].join(';');

  function open() {
    if (!mounted) { document.body.appendChild(frame); mounted = true; }
    frame.style.display = 'block';
    button.style.display = 'none';
  }

  function close() {
    frame.style.display = 'none';
    button.style.display = 'block';
  }

  button.addEventListener('click', open);

  // El iframe pide cerrarse por postMessage. Verifica el origen siempre.
  window.addEventListener('message', function (event) {
    if (event.origin !== origin) return;
    if (event.data === 'assistant:close') close();
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(button);
  });
})();
