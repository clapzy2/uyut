import { headers } from 'next/headers'
import { cache } from 'react'
import { getAuth } from './auth'

// Один запрос сессии на рендер, сколько бы компонентов её ни спрашивали
export const getSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() })
})
