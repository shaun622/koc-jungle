// Tournament rules have one portable implementation shared by the browser and
// Supabase Edge Functions. Keep this adapter free of alternate rule logic.
export * from '../../../supabase/functions/_shared/tournament/index';

