//! Exportar a PDF e imprimir con el motor de impresión de WebKitGTK.
//!
//! El documento se imprime siempre en A4 con márgenes estrechos; el aspecto
//! (tipografía compacta, colores claros, saltos de página) lo pone `print.css`.
//! Para el PDF se usa la impresora virtual «Imprimir a un archivo» de GTK sin
//! mostrar el diálogo.

use tauri::WebviewWindow;

#[cfg(target_os = "linux")]
mod imp {
    use std::cell::RefCell;
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::rc::Rc;

    use gtk::prelude::*;
    use tauri::WebviewWindow;
    use tokio::sync::oneshot;
    use webkit2gtk::{PrintOperation, PrintOperationExt, PrintOperationResponse};

    /// Márgenes de la página en milímetros: (arriba/abajo, izquierda/derecha).
    const MARGIN_MM: (f64, f64) = (12.0, 13.0);

    // `gtk_enumerate_printers` y `GtkPrinter` (gtkunixprint) no tienen binding en gtk-rs 0.18,
    // pero están en la propia libgtk-3 que ya enlaza Tauri.
    #[repr(C)]
    struct GtkPrinter {
        _private: [u8; 0],
    }
    type PrinterFunc = unsafe extern "C" fn(*mut GtkPrinter, *mut c_void) -> c_int;
    extern "C" {
        fn gtk_enumerate_printers(func: PrinterFunc, data: *mut c_void, destroy: Option<unsafe extern "C" fn(*mut c_void)>, wait: c_int);
        fn gtk_printer_get_name(printer: *mut GtkPrinter) -> *const c_char;
        fn gtk_printer_is_virtual(printer: *mut GtkPrinter) -> c_int;
        fn gtk_printer_accepts_pdf(printer: *mut GtkPrinter) -> c_int;
    }

    unsafe extern "C" fn pick_file_printer(printer: *mut GtkPrinter, data: *mut c_void) -> c_int {
        let found = &mut *(data as *mut Option<String>);
        if std::env::var_os("TOTALMD_DEBUG").is_some() {
            let name = CStr::from_ptr(gtk_printer_get_name(printer)).to_string_lossy();
            eprintln!("[print] impresora {name:?} virtual={} pdf={}", gtk_printer_is_virtual(printer), gtk_printer_accepts_pdf(printer));
        }
        if gtk_printer_is_virtual(printer) != 0 && gtk_printer_accepts_pdf(printer) != 0 {
            *found = Some(CStr::from_ptr(gtk_printer_get_name(printer)).to_string_lossy().into_owned());
            return 1; // detener la enumeración
        }
        0
    }

    /// Nombre de la impresora «Imprimir a un archivo» (depende del idioma del sistema).
    fn file_printer_name() -> Option<String> {
        let mut found: Option<String> = None;
        unsafe { gtk_enumerate_printers(pick_file_printer, &mut found as *mut _ as *mut c_void, None, 1) };
        found
    }

    fn a4_setup() -> (gtk::PageSetup, gtk::PrintSettings) {
        let paper = gtk::PaperSize::new(Some(gtk::PAPER_NAME_A4));
        let setup = gtk::PageSetup::new();
        setup.set_paper_size(&paper);
        setup.set_orientation(gtk::PageOrientation::Portrait);
        setup.set_top_margin(MARGIN_MM.0, gtk::Unit::Mm);
        setup.set_bottom_margin(MARGIN_MM.0, gtk::Unit::Mm);
        setup.set_left_margin(MARGIN_MM.1, gtk::Unit::Mm);
        setup.set_right_margin(MARGIN_MM.1, gtk::Unit::Mm);
        let settings = gtk::PrintSettings::new();
        settings.set_paper_size(&paper);
        settings.set_orientation(gtk::PageOrientation::Portrait);
        (setup, settings)
    }

    type Done = oneshot::Sender<Result<bool, String>>;

    /// Lanza la impresión en el hilo de GTK. Con `pdf` escribe el archivo sin diálogo.
    fn start(window: &WebviewWindow, pdf: Option<String>, tx: Done) -> Result<(), String> {
        window
            .with_webview(move |wv| {
                let tx = Rc::new(RefCell::new(Some(tx)));
                let send = {
                    let tx = tx.clone();
                    move |r: Result<bool, String>| {
                        if let Some(tx) = tx.borrow_mut().take() {
                            let _ = tx.send(r);
                        }
                    }
                };

                let (setup, settings) = a4_setup();
                if let Some(path) = &pdf {
                    let Some(printer) = file_printer_name() else {
                        return send(Err("no se encontró la impresora «Imprimir a un archivo» de GTK".into()));
                    };
                    let uri = match gtk::glib::filename_to_uri(path, None) {
                        Ok(u) => u,
                        Err(e) => return send(Err(e.to_string())),
                    };
                    settings.set_printer(&printer);
                    settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
                    settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&uri));
                }

                let webview = wv.inner();
                let parent = webview.toplevel().and_then(|w| w.downcast::<gtk::Window>().ok());
                let op = PrintOperation::new(&webview);
                op.set_page_setup(&setup);
                op.set_print_settings(&settings);

                // La operación debe vivir hasta `finished`; se suelta allí.
                let keep = Rc::new(RefCell::new(Some(op.clone())));
                let s = send.clone();
                op.connect_failed(move |_, err| s(Err(err.to_string())));
                let s = send.clone();
                op.connect_finished(move |_| {
                    s(Ok(true));
                    keep.borrow_mut().take();
                });

                if pdf.is_some() {
                    op.print();
                } else if op.run_dialog(parent.as_ref()) == PrintOperationResponse::Cancel {
                    send(Ok(false));
                }
            })
            .map_err(|e| e.to_string())
    }

    /// Imprime y espera a que termine. Devuelve `false` si se canceló el diálogo.
    pub async fn print(window: WebviewWindow, pdf: Option<String>) -> Result<bool, String> {
        let (tx, rx) = oneshot::channel();
        start(&window, pdf, tx)?;
        rx.await.map_err(|_| "la impresión terminó sin resultado".to_string())?
    }
}

/// Cuenta las páginas de un PDF generado por cairo (objetos `/Type /Page`).
fn count_pages(path: &str) -> Option<u32> {
    let bytes = std::fs::read(path).ok()?;
    let needle = b"/Type /Page";
    let n = bytes
        .windows(needle.len() + 1)
        .filter(|w| &w[..needle.len()] == needle && w[needle.len()] != b's')
        .count();
    (n > 0).then_some(n as u32)
}

#[derive(serde::Serialize)]
pub struct PrintResult {
    done: bool,
    pages: Option<u32>,
}

/// Exporta el documento visible a `pdf_path` (sin diálogo) o, sin ruta, abre el diálogo de impresión.
#[tauri::command]
pub async fn print_document(window: WebviewWindow, pdf_path: Option<String>) -> Result<PrintResult, String> {
    #[cfg(target_os = "linux")]
    {
        let done = imp::print(window, pdf_path.clone()).await?;
        let pages = if done { pdf_path.as_deref().and_then(count_pages) } else { None };
        Ok(PrintResult { done, pages })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, pdf_path, count_pages);
        Err("Exportar a PDF solo está disponible en Linux".into())
    }
}
