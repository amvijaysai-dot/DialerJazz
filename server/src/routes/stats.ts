import { Router, Response, NextFunction } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/dashboard', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user_id = req.user.id;

    // Run parallel queries since postgrest doesn't easily let us do multi-table aggregate in one query
    const [campaignsResult, leadsResult, callsResult, dispositionResult] = await Promise.all([
      req.db!.database.from('campaigns').select('id', { count: 'exact', head: true }).eq('user_id', user_id),
      req.db!.database.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', user_id),
      // Count actual distinct call logs
      req.db!.database.from('call_logs').select('id', { count: 'exact', head: true }).eq('user_id', user_id),
      // Disposition breakdown for dashboard metrics
      req.db!.database
        .from('call_logs')
        .select('disposition')
        .eq('user_id', user_id)
    ]);

    if (campaignsResult.error) throw new ApiError(500, campaignsResult.error.message, 'db_error');
    if (leadsResult.error) throw new ApiError(500, leadsResult.error.message, 'db_error');
    if (callsResult.error) throw new ApiError(500, callsResult.error.message, 'db_error');
    if (dispositionResult.error) throw new ApiError(500, dispositionResult.error.message, 'db_error');

    // Tally dispositions
    const counts: Record<string, number> = {};
    (dispositionResult.data || []).forEach((row: any) => {
      const d = row.disposition;
      if (d) counts[d] = (counts[d] || 0) + 1;
    });

    res.json({
      data: {
        totalCampaigns: campaignsResult.count || 0,
        totalLeads: leadsResult.count || 0,
        totalCallsMade: callsResult.count || 0,
        totalMeetingsBooked: counts['meeting_booked'] || 0,
        totalCallbacks: counts['callback'] || 0,
        totalInterested: counts['answered'] || 0,
        totalNotInterested: counts['not_interested'] || 0,
        totalDoNotCall: counts['dnc'] || 0,
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
