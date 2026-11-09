// Evita una consola extra en Windows en modo release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK 2.52 + Mesa: el proceso web puede corromper el heap al liberar el
    // dispositivo GBM del renderizador DMA-BUF durante exit() (Ubuntu muestra
    // "WebKitWebProcess has stopped unexpectedly" al cerrar). Sin ese renderizador
    // no se crea el dispositivo GBM. Se respeta si el usuario ya fijó la variable.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    totalmd_lib::run()
}
