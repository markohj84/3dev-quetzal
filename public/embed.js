(function () {
  var script = document.currentScript;
  var origin = new URL(script.src).origin;
  var mounted = false;

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Abrir asistente');
  button.style.cssText = [
    'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483000',
    'border:0', 'padding:0', 'background:none', 'cursor:pointer',
    'width:56px', 'height:56px'
  ].join(';');

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
