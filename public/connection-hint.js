if (window.location.protocol === 'file:') {
  const notice = document.createElement('aside');
  notice.className = 'launch-warning';
  notice.setAttribute('role', 'alert');
  notice.innerHTML = '<strong>Halaman dibuka sebagai file lokal.</strong> Jalankan <code>node server.js</code>, lalu buka alamat HTTPS yang ditampilkan server, misalnya <code>https://IP-SERVER:8080/broadcaster.html</code> atau <code>https://IP-SERVER:8080/viewer.html</code>. Jangan buka file HTML langsung dari File Explorer. Sertifikat HTTPS harus memiliki SAN untuk IP server dan dipercaya oleh setiap perangkat.';
  document.body.prepend(notice);
}
