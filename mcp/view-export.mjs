import {z} from 'zod';

export const batchViewExportSchema=z.object({
  documentIdentity:z.string().min(1).max(200).refine(value=>value.trim().length>0,'Document identity must not be blank.'),
  expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  viewIds:z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'View IDs must be unique.'),
  pixelSize:z.number().int().min(600).max(8192).default(4096),
  resolutionDpi:z.union([z.literal(72),z.literal(150),z.literal(300),z.literal(600)]).default(300)
}).strict();

export async function exportViewImages(input,call,signal){
  const request=batchViewExportSchema.parse(input);
  signal?.throwIfAborted();
  return call('revit.view.export_images',request,signal);
}
