import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Projeto Supabase do ActionLog.
 * A chave publicável é feita para ficar no navegador: quem protege os dados são as regras de RLS
 * (cada usuário só lê e escreve no time de que faz parte). Pode ser trocada por variáveis de ambiente.
 */
const DEFAULT_URL = 'https://flniuxtlodyumvfennyw.supabase.co'
const DEFAULT_KEY = 'sb_publishable_hqVxqwrddBGepcVYbxcXMw_wprmBUXX'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || DEFAULT_KEY

export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null
