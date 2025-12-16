import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../lib/prisma'
import { fetchRecentMessages } from '../../lib/services/slackService'
import { createCompanyNote } from '../../lib/services/hubspotService'
import { generateSummary, generateFallbackSummary } from '../../lib/services/openaiService'
import { getUserMap, formatMessagesForSummary } from '../../lib/services/userMappingService'
import { getCadencesForToday } from '../../lib/services/cadenceService'

// Force dynamic execution to prevent caching issues with Vercel cron jobs
export const dynamic = 'force-dynamic'

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // Handle Vercel Cron (GET)
    // Vercel cron jobs send x-vercel-cron header automatically
    const isVercelCron = req.headers['x-vercel-cron'] === '1'
    
    if (req.method === 'GET') {
        // If CRON_SECRET is set, verify it matches (unless it's a Vercel cron)
        if (process.env.CRON_SECRET && !isVercelCron) {
            const authHeader = req.headers.authorization || ''
            const expectedAuth = `Bearer ${process.env.CRON_SECRET}`
            if (authHeader !== expectedAuth) {
                console.error('[CRON] Unauthorized: Missing or invalid CRON_SECRET')
                return res.status(401).json({ error: 'Unauthorized' })
            }
        }
        // Log cron execution
        console.log('[CRON] Cron job triggered', {
            isVercelCron,
            hasAuth: !!req.headers.authorization,
            hasVercelHeader: !!req.headers['x-vercel-cron']
        })
    } else if (req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST'])
        return res.status(405).end(`Method ${req.method} Not Allowed`)
    }

    // Determine if this is a cron call (GET) or manual call (POST)
    const isCronCall = req.method === 'GET'
    let cronLogId: number | null = null

    try {
        const { mappingId, test } = req.body || {}
        
        // Create cron log entry if this is a cron call
        let cadenceResult: any = null
        
        if (isCronCall) {
            cadenceResult = getCadencesForToday()
            
            // Create cron log entry
            try {
                const cronLog = await prisma.cronLog.create({
                    data: {
                        status: 'running',
                        cadences: cadenceResult.cadences || [],
                        dayOfWeek: cadenceResult.dayOfWeek,
                        dayOfMonth: cadenceResult.dayOfMonth,
                        lastDayOfMonth: cadenceResult.lastDayOfMonth,
                        mappingsFound: 0,
                        mappingsExecuted: 0,
                        mappingsFailed: 0,
                    }
                })
                cronLogId = cronLog.id
                console.log(`[CRON LOG] Created cron log entry with ID: ${cronLogId}`)
            } catch (logError: any) {
                console.error('[CRON LOG] Failed to create cron log entry:', logError)
                // Continue execution even if log creation fails
            }
            
            if (!cadenceResult.shouldSync) {
                console.log(`[CRON] No mappings should sync today (Day: ${cadenceResult.dayOfWeek}, Date: ${cadenceResult.dayOfMonth}/${cadenceResult.lastDayOfMonth})`)
                
                // Update cron log if it was created
                if (cronLogId) {
                    await prisma.cronLog.update({
                        where: { id: cronLogId },
                        data: {
                            status: 'completed',
                            completedAt: new Date(),
                        }
                    }).catch((updateError: any) => {
                        console.error('[CRON LOG] Failed to update cron log:', updateError)
                    })
                }
                
                return res.status(200).json({ 
                    message: 'No mappings scheduled for sync today', 
                    results: [],
                    cadence: {
                        dayOfWeek: cadenceResult.dayOfWeek,
                        dayOfMonth: cadenceResult.dayOfMonth,
                        lastDayOfMonth: cadenceResult.lastDayOfMonth
                    }
                })
            }
        }
        
        // Build where clause
        let whereClause: any = mappingId ? { id: Number(mappingId) } : {}
        
        // If this is a cron call, filter by cadence based on current date
        if (isCronCall && cadenceResult) {
            whereClause.cadence = { in: cadenceResult.cadences }
            console.log(`[CRON] Filtering mappings by cadence: ${cadenceResult.cadences.join(', ')} (Day: ${cadenceResult.dayOfWeek}, Date: ${cadenceResult.dayOfMonth}/${cadenceResult.lastDayOfMonth})`)
        }
        
        const mappings = await prisma.mapping.findMany({ 
            where: whereClause,
            include: {
                slackChannels: {
                    include: {
                        slackChannel: true
                    }
                },
                hubspotCompany: true
            }
        })
        
        // Update cron log with mappings found
        if (isCronCall && cronLogId) {
            try {
                await prisma.cronLog.update({
                    where: { id: cronLogId },
                    data: { mappingsFound: mappings.length }
                })
                console.log(`[CRON] Found ${mappings.length} mapping(s) to sync`)
            } catch (updateError: any) {
                console.error('[CRON LOG] Failed to update mappings found:', updateError)
            }
        }
        
        const results = []
        const isTestMode = test === true
        const mappingStatuses: Map<number, { success: boolean; error?: string }> = new Map()

        // Fetch active prompt once for all mappings
        const activePrompt = await prisma.prompt.findFirst({
            where: { isActive: true }
        })
        const systemPrompt = activePrompt?.content || undefined

        // Fetch user map once for all mappings
        const userMap = await getUserMap()

        for (const mapping of mappings) {
            let mappingSuccess = false
            let mappingError: string | undefined = undefined
            
            // Process each channel in the mapping
            for (const mappingChannel of mapping.slackChannels) {
                try {
                    // 1. Fetch Slack Messages (Last 24 hours)
                    const history = await fetchRecentMessages(
                        mappingChannel.slackChannel.channelId,
                        1
                    )

                    if (!history.messages || history.messages.length === 0) {
                        results.push({ 
                            id: mapping.id, 
                            channelId: mappingChannel.slackChannel.channelId,
                            status: isTestMode ? 'No messages to test' : 'No messages to sync' 
                        })
                        continue
                    }

                    // 2. Format messages with user names
                    const messagesText = formatMessagesForSummary(history.messages, userMap)

                    // 3. Generate Summary using ChatGPT
                    let summaryContent: string
                    try {
                        summaryContent = await generateSummary(
                            messagesText,
                            systemPrompt,
                            mappingChannel.slackChannel.name || mappingChannel.slackChannel.channelId
                        )
                    } catch (openaiErr: any) {
                        // Fallback to simple list if OpenAI fails
                        summaryContent = generateFallbackSummary(
                            history.messages,
                            openaiErr.message || 'Unknown error'
                        )
                    }

                    // 4. Create Note in HubSpot (skip if test mode)
                    if (!isTestMode) {
                        await createCompanyNote(
                            mapping.hubspotCompany.companyId,
                            summaryContent
                        )

                        // Update last synced timestamp
                        await prisma.mapping.update({
                            where: { id: mapping.id },
                            data: { lastSyncedAt: new Date() }
                        })
                    }

                    results.push({
                        id: mapping.id,
                        channelId: mappingChannel.slackChannel.channelId,
                        status: isTestMode ? 'Test Complete' : 'Synced',
                        summary: summaryContent,
                        destination: {
                            name: mapping.hubspotCompany.name,
                            id: mapping.hubspotCompany.companyId
                        }
                    })
                    
                    // Mark mapping as successful if at least one channel succeeded
                    mappingSuccess = true

                } catch (error: any) {
                    const errorMsg = error.message || 'Unknown error'
                    console.error(`[SYNC ERROR] ${isTestMode ? 'Testing' : 'Syncing'} mapping ${mapping.id} channel ${mappingChannel.slackChannel.channelId}:`, errorMsg)
                    console.error(`[SYNC ERROR] Full error details:`, error)
                    results.push({ 
                        id: mapping.id, 
                        channelId: mappingChannel.slackChannel.channelId,
                        status: 'Failed', 
                        error: errorMsg
                    })
                    
                    // Track error for this mapping
                    if (!mappingError) {
                        mappingError = errorMsg
                    }
                }
            }
            
            // Track mapping status for cron log
            if (isCronCall && cronLogId) {
                mappingStatuses.set(mapping.id, {
                    success: mappingSuccess,
                    error: mappingError
                })
            }
        }

        // Update cron log with execution results
        if (isCronCall && cronLogId) {
            let mappingsExecuted = 0
            let mappingsFailed = 0
            
            // Create cron log mapping entries and count successes/failures
            const mappingEntries = Array.from(mappingStatuses.entries())
            for (const [mappingId, status] of mappingEntries) {
                try {
                    await prisma.cronLogMapping.create({
                        data: {
                            cronLogId: cronLogId,
                            mappingId: mappingId,
                            status: status.success ? 'success' : 'failed',
                            errorMessage: status.error || null,
                        }
                    })
                    
                    if (status.success) {
                        mappingsExecuted++
                    } else {
                        mappingsFailed++
                    }
                } catch (mappingLogError: any) {
                    console.error(`[CRON LOG] Failed to create mapping log entry for mapping ${mappingId}:`, mappingLogError)
                    // Continue processing other mappings
                }
            }
            
            // Update cron log with final status
            try {
                await prisma.cronLog.update({
                    where: { id: cronLogId },
                    data: {
                        status: 'completed',
                        completedAt: new Date(),
                        mappingsExecuted: mappingsExecuted,
                        mappingsFailed: mappingsFailed,
                    }
                })
                console.log(`[CRON LOG] Updated cron log ${cronLogId} with final status`)
            } catch (updateError: any) {
                console.error('[CRON LOG] Failed to update cron log with final status:', updateError)
            }
        }

        return res.status(200).json({ message: 'Sync process completed', results })

    } catch (error: any) {
        console.error('[CRON] Sync Error:', error)
        console.error('[CRON] Error details:', {
            message: error.message,
            code: error.code,
            stack: error.stack,
            isCronCall,
            cronLogId
        })
        
        // Update cron log with error if it exists
        if (isCronCall) {
            if (cronLogId) {
                try {
                    await prisma.cronLog.update({
                        where: { id: cronLogId },
                        data: {
                            status: 'failed',
                            completedAt: new Date(),
                            errorMessage: error.message || 'Internal Server Error',
                        }
                    })
                    console.log(`[CRON LOG] Updated cron log ${cronLogId} with error status`)
                } catch (updateError: any) {
                    console.error('[CRON LOG] Failed to update cron log with error:', updateError)
                }
            } else {
                // Try to create a cron log entry even if we're in error state
                console.log('[CRON LOG] Attempting to create cron log entry for failed sync...')
                try {
                    const errorLog = await prisma.cronLog.create({
                        data: {
                            status: 'failed',
                            completedAt: new Date(),
                            errorMessage: error.message || 'Internal Server Error',
                            cadences: [],
                            mappingsFound: 0,
                            mappingsExecuted: 0,
                            mappingsFailed: 0,
                        }
                    })
                    console.log(`[CRON LOG] Created error log entry with ID: ${errorLog.id}`)
                } catch (createError: any) {
                    console.error('[CRON LOG] CRITICAL: Failed to create error log entry:', createError)
                }
            }
        }
        
        return res.status(500).json({ error: 'Internal Server Error' })
    }
}
