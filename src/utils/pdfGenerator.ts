import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DailyReconciliationSummary,
  FuelDepot,
  TripTicket,
  WorkPlan,
} from '../types/fuel';

export interface GeneratedPdfResult {
  title: string;
  filename: string;
  blobUrl: string;
  doc: jsPDF;
}

const NAVY: [number, number, number] = [11, 25, 44];
const SLATE_TEXT: [number, number, number] = [51, 78, 115];
const LIGHT_GRAY_BG: [number, number, number] = [243, 245, 248];
const BORDER_GRAY: [number, number, number] = [213, 220, 230];

export function generateWorkPlanPdf(workPlan: WorkPlan, tickets: TripTicket[]): GeneratedPdfResult {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Official LGU Bais Header
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, 210, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CITY GOVERNMENT OF BAIS', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('WEEKLY DEPARTMENTAL WORK PLAN & FUEL REQUISITION SCHEDULE', 14, 18);
  doc.text(`Control No: ${workPlan.controlNumber}  |  Project Code: ${workPlan.projectCode}`, 14, 23);

  // Plan Metadata Block
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(workPlan.projectTitle, 14, 37);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_TEXT);
  doc.text(`Office / Department: ${workPlan.department}`, 14, 43);
  doc.text(`Coverage Period: ${workPlan.weekStart} to ${workPlan.weekEnd}`, 14, 48);
  doc.text(`Status: ${workPlan.status.replace(/_/g, ' ').toUpperCase()}`, 14, 53);

  doc.text(`Total Requested: ${workPlan.totalRequestedLiters.toFixed(1)} L`, 142, 43);
  doc.text(`Total Approved: ${workPlan.totalApprovedLiters.toFixed(1)} L`, 142, 48);
  doc.text(`Total Dispensed: ${workPlan.totalDispensedLiters.toFixed(1)} L`, 142, 53);

  // Trip Tickets Table
  const rows = tickets.map((t) => [
    t.ticketNumber,
    `${t.plateNumber}\n${t.driverName}`,
    t.fuelType.toUpperCase(),
    `${t.scheduledDate}\n${t.destination}${t.purposeOrProject ? `\nPurpose: ${t.purposeOrProject}` : ''}`,
    `${t.computedLimitLiters.toFixed(1)} L`,
    `${t.requestedLiters.toFixed(1)} L`,
    `${t.approvedLiters.toFixed(1)} L`,
    `${t.dispensedLiters.toFixed(1)} L`,
    t.status.toUpperCase(),
  ]);

  autoTable(doc, {
    startY: 59,
    head: [[
      'Ticket #',
      'Plate / Driver',
      'Fuel',
      'Date, Destination & Purpose',
      'Auto Limit',
      'Req (L)',
      'Appr (L)',
      'Disp (L)',
      'Status',
    ]],
    body: rows.length > 0 ? rows : [['—', 'No embedded trip tickets', '—', '—', '—', '—', '—', '—', '—']],
    styles: {
      fontSize: 7.5,
      cellPadding: 2.5,
      textColor: NAVY,
      lineColor: BORDER_GRAY,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: NAVY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: LIGHT_GRAY_BG,
    },
  });

  const finalY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 120) + 10;

  // Approver Note if any
  let signY = finalY;
  if (workPlan.approverNote) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...NAVY);
    doc.text('Tabletop Assessment Note:', 14, signY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...SLATE_TEXT);
    doc.text(workPlan.approverNote, 14, signY + 5, { maxWidth: 182 });
    signY += 15;
  }

  // Mandatory Hierarchical Sign-off Matrix
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...NAVY);
  doc.text('MANDATORY HIERARCHICAL VALIDATION & ACCOUNTABILITY SIGN-OFFS', 14, signY);

  autoTable(doc, {
    startY: signY + 3,
    head: [['Prepared by', 'Reviewed by', 'Approved by']],
    body: [
      [
        `${workPlan.preparedBy}\n(${workPlan.preparedByDesignation || 'Preparer / Focal Person'})`,
        `${workPlan.reviewedBy}\n(${workPlan.reviewedByDesignation || 'Department Reviewer'})`,
        `${workPlan.approvedBy}\n(${workPlan.approvedByDesignation || 'Approving Authority'})`,
      ],
    ],
    styles: { fontSize: 8.5, cellPadding: 4, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    headStyles: { fillColor: [27, 59, 111], textColor: [255, 255, 255] },
  });

  if (workPlan.divisionHead || workPlan.unitLead || workPlan.sectionManager) {
    const hierarchyY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? signY + 25) + 4;

    autoTable(doc, {
      startY: hierarchyY,
      head: [['Division Head', 'Unit Lead', 'Section Manager']],
      body: [
        [workPlan.divisionHead || '—', workPlan.unitLead || '—', workPlan.sectionManager || '—'],
      ],
      styles: { fontSize: 8.5, cellPadding: 4, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
      headStyles: { fillColor: [51, 78, 115], textColor: [255, 255, 255] },
    });
  }

  const footerY = 285;
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE_TEXT);
  doc.text(
    'Note: Duly approved trip tickets are valid for single daily dispensing at GSO Fuel Depot. Any unserved balance is automatically forfeited.',
    14,
    footerY
  );

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  return {
    title: `Work Plan ${workPlan.controlNumber}`,
    filename: `${workPlan.controlNumber}_BaisCity_WorkPlan.pdf`,
    blobUrl,
    doc,
  };
}

export function generateDailyReconciliationPdf(
  report: DailyReconciliationSummary,
  depots: FuelDepot[]
): GeneratedPdfResult {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, 210, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CITY GOVERNMENT OF BAIS — GSO & INTERNAL AUDIT', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('DAILY FUEL REQUEST, APPROVAL, DISPENSING & RECONCILIATION REPORT', 14, 18);
  doc.text(`Report Date: ${report.date || 'All Active Periods'}  |  Generated: ${new Date().toISOString().slice(0, 16)}`, 14, 23);

  // Executive KPI Strip
  autoTable(doc, {
    startY: 34,
    head: [['Total Requested', 'Total Approved', 'Total Dispensed', 'Forfeited Balance', 'Dispensed Cost (PHP)']],
    body: [[
      `${report.totalRequestedLiters.toFixed(1)} L`,
      `${report.totalApprovedLiters.toFixed(1)} L`,
      `${report.totalDispensedLiters.toFixed(1)} L`,
      `${report.totalForfeitedLiters.toFixed(1)} L`,
      `PHP ${report.totalDispensedCostPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
    ]],
    styles: { fontSize: 8.5, cellPadding: 3, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    headStyles: { fillColor: [27, 59, 111], textColor: [255, 255, 255] },
  });

  const deptY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 55) + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...NAVY);
  doc.text('DEPARTMENTAL CONSUMPTION & COST ANALYSIS', 14, deptY);

  autoTable(doc, {
    startY: deptY + 3,
    head: [['Department / Office', 'Requested (L)', 'Approved (L)', 'Dispensed (L)', 'Forfeited (L)', 'Cost (PHP)']],
    body: report.departmentBreakdown.map((d) => [
      d.department,
      d.requestedLiters.toFixed(1),
      d.approvedLiters.toFixed(1),
      d.dispensedLiters.toFixed(1),
      d.forfeitedLiters.toFixed(1),
      d.costPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 }),
    ]),
    styles: { fontSize: 8, cellPadding: 2.5, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: LIGHT_GRAY_BG },
  });

  const depotY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 110) + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('CITY FUEL DEPOT INVENTORY BALANCES', 14, depotY);

  autoTable(doc, {
    startY: depotY + 3,
    head: [['Depot Name', 'Gasoline Stock / Cap', 'Diesel Stock / Cap', 'Last Dip Verification']],
    body: depots.map((dep) => [
      `${dep.name}\n${dep.location}`,
      `${dep.gasolineCurrentLiters.toLocaleString()} / ${dep.gasolineCapacityLiters.toLocaleString()} L`,
      `${dep.dieselCurrentLiters.toLocaleString()} / ${dep.dieselCapacityLiters.toLocaleString()} L`,
      dep.lastDipVerifiedBy ? `${dep.lastDipVerifiedBy}` : 'Pending Verification',
    ]),
    styles: { fontSize: 8, cellPadding: 2.5, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    headStyles: { fillColor: [51, 78, 115], textColor: [255, 255, 255] },
  });

  const alertY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 160) + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`AUTOMATED RECONCILIATION DISCREPANCY ALERTS (${report.alerts.length})`, 14, alertY);

  autoTable(doc, {
    startY: alertY + 3,
    head: [['Severity', 'Category', 'Alert Summary']],
    body:
      report.alerts.length > 0
        ? report.alerts.map((a) => [a.severity.toUpperCase(), a.category.replace(/_/g, ' '), `${a.title}: ${a.detail}`])
        : [['NOMINAL', 'None', 'No reconciliation discrepancies detected for this period.']],
    styles: { fontSize: 7.5, cellPadding: 2.5, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    headStyles: { fillColor: [185, 28, 28], textColor: [255, 255, 255] },
  });

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  return {
    title: `Daily Fuel Reconciliation Report (${report.date})`,
    filename: `BaisCity_Fuel_Reconciliation_${report.date || 'summary'}.pdf`,
    blobUrl,
    doc,
  };
}

export function generateDispensingLedgerPdf(
  items: Array<{ ticket: TripTicket; workPlanNumber: string }>,
  depots: FuelDepot[],
  filterSummary: string
): GeneratedPdfResult {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const depotNameMap = new Map<string, string>();
  depots.forEach((d) => depotNameMap.set(d.id, d.name));

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, 297, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CITY GOVERNMENT OF BAIS — GSO FUEL DISPENSING LEDGER', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Filtered Scope: ${filterSummary}`, 14, 17);
  doc.text(
    `Records: ${items.length}  |  Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    14,
    22
  );

  const totalApproved = items.reduce((s, x) => s + x.ticket.approvedLiters, 0);
  const totalDispensed = items.reduce((s, x) => s + x.ticket.dispensedLiters, 0);
  const totalVoid = items.reduce((s, x) => s + x.ticket.forfeitedLiters, 0);

  autoTable(doc, {
    startY: 31,
    head: [['Filtered Tickets', 'Total Fuel Approved', 'Total Actual Dispensed', 'Total Void Balance']],
    body: [[
      String(items.length),
      `${totalApproved.toFixed(1)} L`,
      `${totalDispensed.toFixed(1)} L`,
      `${totalVoid.toFixed(1)} L`,
    ]],
    styles: { fontSize: 8.5, cellPadding: 2.5, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    headStyles: { fillColor: [27, 59, 111], textColor: [255, 255, 255] },
  });

  const tableStartY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 48) + 6;

  autoTable(doc, {
    startY: tableStartY,
    head: [[
      'Ticket #',
      'Work Plan #',
      'Category',
      'Department',
      'Plate / Driver',
      'Fuel Type',
      'Approved (L)',
      'Dispensed (L)',
      'Date Needed',
      'Dispensed Timestamp',
      'Proof File',
    ]],
    body:
      items.length > 0
        ? items.map(({ ticket: t, workPlanNumber }) => [
            t.ticketNumber,
            workPlanNumber,
            t.servedOnce ? 'Dispensed' : 'Approved',
            t.department,
            `${t.plateNumber}\n${t.driverName}`,
            t.fuelType.toUpperCase(),
            `${t.approvedLiters.toFixed(1)} L`,
            t.servedOnce ? `${t.dispensedLiters.toFixed(1)} L` : 'Pending',
            t.scheduledDate,
            t.dispensedAt ? t.dispensedAt.slice(0, 16).replace('T', ' ') : 'Pending',
            t.pumpReadingPhotoName || (t.servedOnce ? 'Baseline' : 'Pending'),
          ])
        : [['—', '—', '—', 'No matching records in filtered view', '—', '—', '—', '—', '—', '—', '—']],
    styles: { fontSize: 7.5, cellPadding: 2, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: LIGHT_GRAY_BG },
  });

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);

  return {
    title: `GSO Fuel Dispensing Ledger (${items.length} records)`,
    filename: `BaisCity_GSO_Dispensing_${stamp}.pdf`,
    blobUrl,
    doc,
  };
}
