import PDFDocument from 'pdfkit';

const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
}).format(Number(value || 0));

const date = (value) => value
  ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
  : '—';

export function buildInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: {
      Title: `Invoice ${invoice.invoice_number}`,
      Author: invoice.organization_name || 'SignalLedger',
      Subject: `Podcast advertising invoice for ${invoice.io_number}`,
    } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const navy = '#17233c';
    const blue = '#3568df';
    const muted = '#68748a';
    const rule = '#dce2ec';
    const pageWidth = doc.page.width - 108;

    doc.rect(0, 0, doc.page.width, 14).fill(blue);
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(24).text('SignalLedger', 54, 52);
    doc.fillColor(muted).font('Helvetica').fontSize(9).text('PODCAST AD RECONCILIATION', 55, 82, { characterSpacing: 1.5 });
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(30).text('INVOICE', 350, 50, { width: 207, align: 'right' });
    doc.fillColor(muted).font('Helvetica').fontSize(10).text(invoice.invoice_number, 350, 88, { width: 207, align: 'right' });

    doc.moveTo(54, 116).lineTo(558, 116).strokeColor(rule).lineWidth(1).stroke();
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('FROM', 54, 140, { characterSpacing: 1.2 });
    doc.fillColor(navy).fontSize(12).text(invoice.organization_name || 'SignalLedger workspace', 54, 157);
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(invoice.organization_email || '', 54, 176);

    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('BILL TO', 300, 140, { characterSpacing: 1.2 });
    doc.fillColor(navy).fontSize(12).text(invoice.advertiser_name || 'Advertiser', 300, 157);
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(invoice.recipient_email || 'No billing email on file', 300, 176);

    const metaY = 214;
    const meta = [
      ['ISSUED', date(invoice.issued_at)],
      ['DUE', date(invoice.due_at)],
      ['STATUS', String(invoice.status || 'draft').toUpperCase()],
      ['IO NUMBER', invoice.io_number || '—'],
    ];
    meta.forEach(([label, value], index) => {
      const x = 54 + index * 126;
      doc.fillColor(muted).font('Helvetica-Bold').fontSize(7.5).text(label, x, metaY, { characterSpacing: 1 });
      doc.fillColor(navy).font('Helvetica').fontSize(9.5).text(value, x, metaY + 17, { width: 114 });
    });

    const tableY = 284;
    doc.roundedRect(54, tableY, pageWidth, 30, 4).fill(navy);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
      .text('DESCRIPTION', 68, tableY + 11)
      .text('DELIVERED', 332, tableY + 11, { width: 72, align: 'right' })
      .text('CPM', 416, tableY + 11, { width: 55, align: 'right' })
      .text('AMOUNT', 483, tableY + 11, { width: 61, align: 'right' });
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(10).text(invoice.podcast_title || 'Podcast campaign', 68, tableY + 48, { width: 245 });
    doc.fillColor(muted).font('Helvetica').fontSize(8.5).text(
      `${date(invoice.start_date)} – ${date(invoice.end_date)} · ${Number(invoice.committed_impressions || 0).toLocaleString()} committed impressions`,
      68, tableY + 65, { width: 245 }
    );
    doc.fillColor(navy).fontSize(9.5)
      .text(Number(invoice.delivered_impressions || 0).toLocaleString(), 332, tableY + 51, { width: 72, align: 'right' })
      .text(money(invoice.cpm), 416, tableY + 51, { width: 55, align: 'right' })
      .text(money(invoice.amount), 483, tableY + 51, { width: 61, align: 'right' });
    doc.moveTo(54, tableY + 91).lineTo(558, tableY + 91).strokeColor(rule).stroke();

    const totalY = tableY + 122;
    doc.fillColor(muted).font('Helvetica').fontSize(9).text('Subtotal', 390, totalY, { width: 80, align: 'right' });
    doc.fillColor(navy).text(money(invoice.amount), 483, totalY, { width: 61, align: 'right' });
    doc.fillColor(muted).text('Makegood credit', 390, totalY + 24, { width: 80, align: 'right' });
    doc.fillColor(navy).text(money(invoice.makegood_value || 0), 483, totalY + 24, { width: 61, align: 'right' });
    doc.roundedRect(374, totalY + 49, 184, 42, 5).fill('#edf3ff');
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(10).text('TOTAL DUE', 390, totalY + 65);
    doc.fillColor(blue).fontSize(13).text(money(invoice.net_due ?? invoice.amount), 475, totalY + 63, { width: 69, align: 'right' });

    doc.fillColor(navy).font('Helvetica-Bold').fontSize(10).text('Payment terms', 54, 502);
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(
      `Payment is due within ${invoice.payment_terms_days || 30} days. Please reference ${invoice.invoice_number} with payment.`,
      54, 520, { width: 290, lineGap: 3 }
    );
    doc.fillColor(muted).fontSize(8).text(
      'Generated by SignalLedger from reconciled podcast delivery records.', 54, 720,
      { width: 504, align: 'center' }
    );
    doc.end();
  });
}
