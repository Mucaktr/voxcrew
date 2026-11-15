/**
 * durak paneli açılınca odak. Yürüme tuşları yalnız dünya tuvali (`role="application"`) odaktayken çalışır
 * (`input.ts` requireSelf); F ile açılışta odağı ilk "Bin" düğmesine almak WASD/F'i öldürüyor, Boşluk/Enter ise düğmeye basıp
 * oyuncuyu kazara ilk hedefe bindiriyordu. Odak yalnız dünyada DEĞİLSE (çip tıklaması/Enter: çip kalkınca odak gövdeye düşer) panele taşınır.
*/
export const worldHasFocus = (active: Element | null): boolean => !!active?.closest?.('[role="application"]');
