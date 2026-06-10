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

  // Browser-side image compression profiles
  var _webpSupported = null;
  var IMAGE_PROFILES = {
    // quote_evidence_image: nameplate/spec-sheet — needs more detail
    nameplate: { maxLongEdge: 2000, initQuality: 0.85, targetBytes: 1024 * 1024 },
    // item_image: general RFQ item photo
    normal:    { maxLongEdge: 1600, initQuality: 0.82, targetBytes: 700 * 1024 },
  };
  var QUALITY_STEPS = [0.8, 0.75, 0.72];

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
    var fileKind = String((formData.get && formData.get('fileKind')) || '');
    var profile = fileKind === 'quote_evidence_image' ? IMAGE_PROFILES.nameplate : IMAGE_PROFILES.normal;
    var useWebp = await checkWebpSupport();
    var result = await compressImage(file, profile, useWebp);
    formData.set('file', result.file);
    formData.set('width', String(result.width || 0));
    formData.set('height', String(result.height || 0));
    formData.set('_origSize', String(result.originalSize || 0));
    formData.set('_compSize', String(result.compressedSize || 0));
    if (result.overTarget) formData.set('_overTarget', '1');
  }

  async function checkWebpSupport() {
    if (_webpSupported !== null) return _webpSupported;
    try {
      var c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      var blob = await canvasToBlob(c, 'image/webp', 0.9);
      var buf = await blob.arrayBuffer();
      var b = new Uint8Array(buf);
      // WebP magic: RIFF....WEBP
      _webpSupported = b.length >= 12 &&
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    } catch (e) {
      _webpSupported = false;
    }
    return _webpSupported;
  }

  async function compressImage(file, profile, useWebp) {
    var image = await loadImage(file);
    var sw = image.width || image.naturalWidth || 0;
    var sh = image.height || image.naturalHeight || 0;
    if (!sw || !sh) {
      if (image.close) image.close();
      return { file: file, width: 0, height: 0, originalSize: file.size, compressedSize: file.size, overTarget: false };
    }
    var longEdge = Math.max(sw, sh);
    var scale = longEdge > profile.maxLongEdge ? profile.maxLongEdge / longEdge : 1;
    var tw = Math.max(1, Math.round(sw * scale));
    var th = Math.max(1, Math.round(sh * scale));
    var canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, tw, th);
    if (image.close) image.close();
    var mimeType = useWebp ? 'image/webp' : 'image/jpeg';
    var ext = useWebp ? 'webp' : 'jpg';
    // qualities: [initQuality, ...QUALITY_STEPS below it]
    var qualities = [profile.initQuality].concat(QUALITY_STEPS.filter(function (q) { return q < profile.initQuality; }));
    var safeName = String(file.name || 'image').replace(/\.[^.]*$/, '').replace(/[\\/]+/g, ' ').trim() || 'image';
    var blob = null;
    var overTarget = false;
    for (var i = 0; i < qualities.length; i++) {
      blob = await canvasToBlob(canvas, mimeType, qualities[i]);
      if (blob.size <= profile.targetBytes) break;
      if (i === qualities.length - 1) overTarget = true;
    }
    return {
      file: new File([blob], safeName + '.' + ext, { type: mimeType }),
      width: tw,
      height: th,
      originalSize: file.size,
      compressedSize: blob.size,
      overTarget: overTarget,
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
