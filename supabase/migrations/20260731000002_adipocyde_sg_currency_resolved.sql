-- Resolve the Adipocyde SG currency question flagged in 20260731000009's
-- seed ("prices listed in RM in the source sheet"). Real order history from
-- adipocydesg.com settles it: the store transacted in MYR from 2025-09-30 to
-- 2025-10-24, then switched to SGD on 2025-10-26 and has been SGD since.
update public.stores set currency_code = 'SGD' where domain = 'adipocydesg.com';

update public.products
set description = 'Package pricing from adipocydesg.com. Store transacts in SGD '
               || '(switched from MYR on 2025-10-26 per synced order history); '
               || 'seeded variant prices came from the RM source sheet — Finance to restate in SGD.'
where name = 'Adipocyde — Singapore packages';
