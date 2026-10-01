import { toolRoute } from '@/lib/route';
import { getOptions } from '@/lib/tools';

export const POST = toolRoute('get_options', (sql, input, conversationId) => getOptions(sql, input, conversationId));
