(function () {
  var script = document.currentScript;
  var origin = new URL(script.src).origin;
  var mounted = false;

  // Estilos que un :hover o una @keyframes no se pueden expresar con
  // style.cssText — y el reset global del host (button{background:none})
  // gana empates de especificidad si no viene de una clase propia.
  var style = document.createElement('style');
  style.textContent = [
    '@keyframes quetzal-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}',
    '.quetzal-launcher{',
    '  position:fixed;right:24px;bottom:24px;z-index:2147483000;',
    '  border:0;padding:0;cursor:pointer;width:56px;height:56px;border-radius:9999px;',
    '  background:#5dc4a4;display:flex;align-items:center;justify-content:center;',
    '  box-shadow:0 4px 24px rgba(93,196,164,.45),0 0 0 1px rgba(255,255,255,.12);',
    '  opacity:1;transform:scale(1);pointer-events:auto;',
    '  transition:transform .25s cubic-bezier(.34,1.56,.64,1),opacity .2s ease,box-shadow .2s ease;',
    '}',
    '.quetzal-launcher:hover{transform:scale(1.06);box-shadow:0 6px 28px rgba(93,196,164,.6),0 0 0 1px rgba(255,255,255,.16)}',
    '.quetzal-launcher.quetzal-hidden{opacity:0;transform:scale(.6);pointer-events:none}',
    '.quetzal-launcher .quetzal-dot{',
    '  position:absolute;top:2px;right:2px;width:9px;height:9px;border-radius:9999px;',
    '  background:#9fe1cb;box-shadow:0 0 6px #5dc4a4;animation:quetzal-pulse 2.4s ease infinite;',
    '}'
  ].join('');
  document.head.appendChild(style);

  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'quetzal-launcher';
  button.setAttribute('aria-label', 'Abrir asistente');
  button.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#04342c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
    '<span class="quetzal-dot" aria-hidden="true"></span>';

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
    button.classList.add('quetzal-hidden');
  }

  function close() {
    frame.style.display = 'none';
    button.classList.remove('quetzal-hidden');
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
