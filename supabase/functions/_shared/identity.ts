export const TECHNICAL_EMAIL_DOMAIN = 'usuarios.cotizador.invalid';
export function normalizeUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9_-]$/.test(username) || username.includes('..')) {
    throw new Error('Usa un usuario de 3 a 32 caracteres: letras sin acentos, números, punto, guion o guion bajo; sin puntos seguidos ni punto final.');
  }
  return username;
}
export function technicalEmail(username: string): string {
  return `${normalizeUsername(username)}@${TECHNICAL_EMAIL_DOMAIN}`;
}
