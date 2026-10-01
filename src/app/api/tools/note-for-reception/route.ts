import { toolRoute } from '@/lib/route';
import { noteForReception } from '@/lib/tools';

export const POST = toolRoute('note_for_reception', (sql, input, conversationId) => noteForReception(sql, input, conversationId));
