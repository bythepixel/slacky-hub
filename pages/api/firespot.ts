import type { NextApiRequest, NextApiResponse } from 'next'
import { validateMethod } from '../../../lib/utils/methodValidator'

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!validateMethod(req, res, ['POST'])) return

    return res.status(200).json({ status: 'OK' })
}

