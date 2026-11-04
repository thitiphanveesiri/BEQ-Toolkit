import { notFound } from 'next/navigation';
import CaseForm from '../../../../components/CaseForm.js';

export default async function NewForm({ params }) {
  const { form } = await params;
  if (!['case', 'day0'].includes(form)) notFound();
  return <CaseForm key={form} formType={form} />;
}
