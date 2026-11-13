-- 0177 — CENNIK V2: two more FAQ answers that the rollout made untrue.
--
-- 1. Changing plan: the Stripe customer portal now lets a customer change
--    plan themselves (13.11.2026: upgrades at once with proration, downgrades
--    and annual → monthly from the next period). "Not available yet" is false.
-- 2. Renewal: annual plans exist (renew yearly, credits in 12 monthly
--    grants), and subscription credits now expire at the end of their month,
--    so "the credits stay on the account" after cancelling is false.
--
-- Each answer changes only if it still holds the exact old Polish text, so an
-- admin's later edit is never overwritten. Idempotent.

update public.faq_items set answer = jsonb_build_object(
  'pl', 'Tak. Plan zmienisz w ustawieniach konta, w zakładce Plan, przyciskiem „Zarządzaj płatnościami”. Przejście na wyższy plan działa od razu: dopłacasz różnicę za pozostałą część okresu, a kredyty przeliczamy proporcjonalnie. Przejście na niższy plan lub z rocznego na miesięczny zaczyna obowiązywać od kolejnego okresu rozliczeniowego.',
  'en', 'Yes. Change your plan in your account settings, on the Plan tab, with “Manage billing”. Moving to a higher plan takes effect at once: you pay the difference for the rest of the period and your credits are adjusted proportionally. Moving to a lower plan, or from annual to monthly, takes effect from the next billing period.',
  'de', 'Ja. Du änderst deinen Plan in den Kontoeinstellungen im Tab „Plan“ über „Zahlungen verwalten“. Ein Wechsel zu einem höheren Plan gilt sofort: Du zahlst die Differenz für den Rest des Zeitraums, und deine Credits werden anteilig angepasst. Ein Wechsel zu einem niedrigeren Plan oder von jährlich zu monatlich gilt ab dem nächsten Abrechnungszeitraum.')
 where id = 'b2fbce7a-8052-4565-9030-faaf6b5834b8'
   and answer->>'pl' = 'Samodzielna zmiana planu w panelu nie jest jeszcze dostępna. Napisz do nas, a przeprowadzimy zmianę — albo anuluj obecny plan i po zakończeniu opłaconego okresu wybierz nowy.';

update public.faq_items set answer = jsonb_build_object(
  'pl', 'Tak — plan miesięczny odnawia się co miesiąc, a roczny co rok. Kredyty z planu dostajesz co miesiąc (plan roczny to 12 miesięcznych przydziałów) i są ważne do końca danego miesiąca. Subskrypcję anulujesz w panelu płatności Stripe: plan działa do końca opłaconego okresu. Kredyty z doładowań nie wygasają i możesz z nich korzystać, gdy masz aktywny plan.',
  'en', 'Yes — a monthly plan renews every month and an annual plan every year. You receive your plan''s credits every month (an annual plan is 12 monthly grants) and they are valid until the end of that month. You cancel in the Stripe billing portal: the plan stays active until the end of the paid period. Top-up credits never expire and can be used while you have an active plan.',
  'de', 'Ja — ein Monatsplan verlängert sich jeden Monat, ein Jahresplan jedes Jahr. Die Credits deines Plans erhältst du monatlich (ein Jahresplan sind 12 monatliche Zuteilungen), und sie gelten bis zum Ende des jeweiligen Monats. Kündigen kannst du im Stripe-Zahlungsportal: Der Plan bleibt bis zum Ende des bezahlten Zeitraums aktiv. Aufgeladene Credits verfallen nicht und sind nutzbar, solange du einen aktiven Plan hast.')
 where id = '83484532-76a3-4ce7-8275-c7744c20f050'
   and answer->>'pl' = 'Tak — plan odnawia się co miesiąc, a po każdej opłaconej płatności dodajemy kredyty z planu. Subskrypcję anulujesz w panelu płatności Stripe: plan działa do końca opłaconego okresu, a kredyty zostają na koncie.';
