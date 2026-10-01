import { toolRoute } from '@/lib/route';
import { findPatient } from '@/lib/tools';

export const POST = toolRoute('find_patient', (sql, input) => findPatient(sql, input));
