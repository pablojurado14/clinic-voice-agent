import { toolRoute } from '@/lib/route';
import { book } from '@/lib/tools';

export const POST = toolRoute('book', (sql, input, conversationId) => book(sql, input, conversationId));
