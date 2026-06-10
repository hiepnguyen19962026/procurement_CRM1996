(function () {
  async function call(action, payload) {
    var res = await fetch('/api/fetch-data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(Object.assign({}, payload || {}, { action: action })),
    });
    var data = await res.json().catch(function () { return { ok: false, error: 'Loi API' }; });
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Loi API');
    return data;
  }

  async function get(action, params) {
    var qs = new URLSearchParams(Object.assign({}, params || {}, { action: action }));
    var res = await fetch('/api/fetch-data?' + qs.toString(), { credentials: 'include' });
    var data = await res.json().catch(function () { return { ok: false, error: 'Loi API' }; });
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Loi API');
    return data;
  }

  async function upload(formData) {
    await prepareUploadForm(formData);
    var res = await fetch('/api/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    var data = await res.json().catch(function () { return { ok: false, error: 'Loi upload' }; });
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Loi upload');
    return data;
  }

  async function prepareUploadForm(formData) {
    var file = formData && formData.get && formData.get('file');
    if (!file || !file.type || !/^image\//i.test(file.type)) return;
    if (!/^(image\/jpeg|image\/png|image\/webp)$/i.test(file.type)) return;
    var resized = await resizeImageFile(file, 1600, 1600, 0.86);
    formData.set('file', resized.file);
    formData.set('width', String(resized.width || 0));
    formData.set('height', String(resized.height || 0));
  }

  async function resizeImageFile(file, maxWidth, maxHeight, quality) {
    var image = await loadImage(file);
    var sourceWidth = image.width || image.naturalWidth || 0;
    var sourceHeight = image.height || image.naturalHeight || 0;
    if (!sourceWidth || !sourceHeight) return { file: file, width: 0, height: 0 };
    var scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
    var targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    var targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    var canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    if (image.close) image.close();
    var blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    var safeName = String(file.name || 'image').replace(/\.[^.]*$/, '').replace(/[\\/]+/g, ' ').trim() || 'image';
    return {
      file: new File([blob], safeName + '.jpg', { type: 'image/jpeg' }),
      width: targetWidth,
      height: targetHeight,
    };
  }

  async function loadImage(file) {
    if (window.createImageBitmap) return createImageBitmap(file);
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Khong doc duoc anh upload'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Khong toi uu duoc anh upload'));
      }, type, quality);
    });
  }

  function mediaUrl(fileId) {
    return '/api/media?fileId=' + encodeURIComponent(fileId || '');
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  function money(value) {
    var n = Number(value || 0);
    return n ? Math.round(n).toLocaleString('vi-VN') : '';
  }

  function toast(message, type) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = message;
    box.className = 'toast show ' + (type || 'info');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { box.className = 'toast'; }, 2600);
  }

  function error(err) {
    toast(err && err.message ? err.message : String(err || 'Co loi'), 'error');
  }

  window.API = { call: call, get: get, upload: upload, mediaUrl: mediaUrl, esc: esc, money: money, toast: toast, error: error };
})();
