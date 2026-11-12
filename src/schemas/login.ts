import { z } from 'zod'
import { i18n } from '@/i18n'

export function createLoginSchema(opts?: { mobile?: boolean }) {
  const t = i18n.global.t
  const mobile = Boolean(opts?.mobile)
  return z.object({
    employeeCode: z.string().trim().min(1, t('validation.employeeCodeRequired')),
    password: mobile
      ? z.string().trim().optional().default('')
      : z.string().trim().min(1, t('validation.passwordRequired')),
  })
}

export type LoginFormValues = z.infer<ReturnType<typeof createLoginSchema>>
