import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { getDbPool, withTransaction } from '../lib/db.js';

const router = Router();
router.use(requireAuth);

const createCampaignSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be under 100 characters'),
  dialer_mode: z.enum(['preview', 'power', 'predictive', 'click']).default('preview'),
  provider: z.enum(['telnyx', 'twilio', 'local']).default('telnyx'),
  caller_number: z.string().optional(),
});

router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 50));
    const offset = (page - 1) * perPage;

    const { data, count, error } = await req.db!
      .database.from('campaigns')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    if (error) throw new ApiError(500, error.message, 'db_error');

    const total = count || 0;

    res.json({
      data: data || [],
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await req.db!
      .database.from('campaigns')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new ApiError(404, 'Campaign not found', 'not_found');
      throw new ApiError(500, error.message, 'db_error');
    }

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

  router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const body = createCampaignSchema.parse(req.body);
      const pool = getDbPool();

      const { rows } = await pool.query(
        `INSERT INTO public.campaigns (user_id, name, dialer_mode, provider, caller_number, status)
         VALUES ($1, $2, $3, $4, $5, 'draft')
         RETURNING *`,
        [
          req.user.id,
          body.name,
          body.dialer_mode,
          body.provider,
          body.caller_number || null,
        ]
      );

      if (!rows.length) {
        throw new ApiError(500, 'Failed to create campaign', 'db_error');
      }

      res.status(201).json({ data: rows[0] });
    } catch (error) {
      next(error);
    }
  });

router.patch('/:id/status', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const statusSchema = z.object({ status: z.enum(['draft', 'scheduled', 'active', 'paused', 'completed', 'archived']) });
    const { status } = statusSchema.parse(req.body);
    const pool = getDbPool();

    const { rows } = await pool.query(
      `UPDATE public.campaigns
       SET status = $1, updated_at = now()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [status, req.params.id, req.user.id]
    );

    if (!rows.length) throw new ApiError(404, 'Campaign not found', 'not_found');
    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/config', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const configSchema = z.object({
      dialer_mode: z.enum(['preview', 'power', 'predictive', 'click']).optional(),
      provider: z.enum(['telnyx', 'twilio', 'local']).optional(),
      caller_number: z.string().optional().nullable(),
    });
    const updates = configSchema.parse(req.body);
    const pool = getDbPool();

    // Fetch current status to enforce the lock
    const { rows: existing } = await pool.query(
      `SELECT status FROM public.campaigns WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (!existing.length) {
      throw new ApiError(404, 'Campaign not found', 'not_found');
    }

    if (existing[0].status !== 'draft') {
      throw new ApiError(400, 'Cannot modify campaign configuration after it has been launched (status is not draft)', 'bad_request');
    }

    const setClauses: string[] = ['updated_at = now()'];
    const values: any[] = [];
    // WHERE clause uses $1 (id) and $2 (user_id), so SET fields start at $3.
    let idx = 2;
    if (updates.dialer_mode !== undefined) { setClauses.push(`dialer_mode = $${++idx}`); values.push(updates.dialer_mode); }
    if (updates.provider !== undefined) { setClauses.push(`provider = $${++idx}`); values.push(updates.provider); }
    if (updates.caller_number !== undefined) { setClauses.push(`caller_number = $${++idx}`); values.push(updates.caller_number); }

    const { rows } = await pool.query(
      `UPDATE public.campaigns SET ${setClauses.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id, ...values]
    );

    if (!rows.length) throw new ApiError(404, 'Campaign not found', 'not_found');
    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/rename', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const renameSchema = z.object({ name: z.string().min(1).max(100) });
    const { name } = renameSchema.parse(req.body);
    const pool = getDbPool();

    const { rows } = await pool.query(
      `UPDATE public.campaigns SET name = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING *`,
      [name, req.params.id, req.user.id]
    );

    if (!rows.length) throw new ApiError(404, 'Campaign not found', 'not_found');
    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const pool = getDbPool();
    const { rowCount } = await pool.query(
      `DELETE FROM public.campaigns WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (!rowCount) throw new ApiError(404, 'Campaign not found', 'not_found');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
