import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DailyReconciliationSummary,
  FleetVehicle,
  FuelDepot,
  ReportUtilitiesConfig,
  TripTicket,
  WorkPlan,
  WorkPlanReportLayoutVariant,
} from '../types/fuel';
import {
  getActiveReportUtilityKeys,
  getDepartmentMnemonic,
  getOrderedWorkPlanFullReportSections,
  getWorkPlanDepartmentSignOffs,
  getWorkPlanDisplayLabel,
  getWorkPlanFullReportSummaryItems,
  getWorkPlanReportTargetsForVariant,
  resolveWorkPlanReportLayoutVariant,
} from './fuelEngine';

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

export function generateWorkPlanPdf(
  workPlan: WorkPlan,
  tickets: TripTicket[],
  reportUtilities?: ReportUtilitiesConfig,
  vehicles?: FleetVehicle[],
  explicitLayoutVariant?: WorkPlanReportLayoutVariant
): GeneratedPdfResult {
  const layoutVariant = resolveWorkPlanReportLayoutVariant(workPlan, explicitLayoutVariant);
  const layoutTargets = getWorkPlanReportTargetsForVariant(layoutVariant);
  const activeReviewSections = getActiveReportUtilityKeys(
    reportUtilities,
    layoutTargets.sectionsTarget
  );
  const activeTicketCols = getActiveReportUtilityKeys(
    reportUtilities,
    layoutTargets.ticketColsTarget
  );
  const useLandscape = activeTicketCols.length > 8;
  const doc = new jsPDF({
    orientation: useLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Official LGU Bais Header
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CITY GOVERNMENT OF BAIS', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const layoutTag =
    layoutVariant === 'for_approval' ? 'FOR APPROVAL' : 'POST-APPROVAL MONITORING';
  doc.text(
    workPlan.requestType === 'single_trip'
      ? `SINGLE TRIP TICKET & URGENT FUEL REQUISITION — ${layoutTag}`
      : `WEEKLY DEPARTMENTAL WORK PLAN & FUEL SCHEDULE — ${layoutTag}`,
    14,
    18
  );
  const isSingleTrip = workPlan.requestType === 'single_trip';
  const displayRef = getWorkPlanDisplayLabel(workPlan);
  const headerRefLine = isSingleTrip
    ? `Request Type: ${displayRef}`
    : `Control No: ${displayRef}`;
  doc.text(
    workPlan.preparationDate
      ? `${headerRefLine}  |  Prepared: ${workPlan.preparationDate}`
      : headerRefLine,
    14,
    23
  );

  // Plan Metadata Block
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(workPlan.projectTitle, 14, 37);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_TEXT);
  const deptMnemonic = getDepartmentMnemonic(workPlan.department, vehicles);
  doc.text(`Dept: ${deptMnemonic} (${workPlan.department})`, 14, 43);
  doc.text(
    workPlan.requestType === 'single_trip'
      ? `Expected Date: ${workPlan.weekStart}`
      : `Coverage Period: ${workPlan.weekStart} to ${workPlan.weekEnd}`,
    14,
    48
  );
  doc.text(`Status: ${workPlan.status.replace(/_/g, ' ').toUpperCase()}`, 14, 53);

  let cursorY = 59;

  const ticketHeadMap: Record<string, string> = {
    ticketNumber: 'Ticket #',
    vehicle: 'Vehicle / Fuel',
    driver: 'Driver',
    purpose: 'Purpose',
    aipCode: 'AIP Code',
    scheduledDate: 'Scheduled Date',
    destination: 'Destination',
    autoLimit: 'Auto Limit',
    requested: 'Req (L)',
    approved: 'Appr (L)',
    dispensed: 'Disp (L)',
    state: 'Status',
  };

  const mapTicketCell = (t: TripTicket, key: string): string => {
    switch (key) {
      case 'ticketNumber':
        return t.ticketNumber;
      case 'vehicle':
        return `${t.plateNumber}\n${t.vehicleLabel || ''} (${t.fuelType.toUpperCase()})`.trim();
      case 'driver':
        return `${t.driverName}${t.driverLicense ? `\n${t.driverLicense}` : ''}`;
      case 'purpose':
        return t.purposeOrProject || t.projectTitle || '—';
      case 'aipCode':
        return (t.projectAip || workPlan.projectCode || '').trim() || '—';
      case 'scheduledDate':
        return t.scheduledDate || '—';
      case 'destination':
        return t.destination || '—';
      case 'autoLimit':
        return `${t.computedLimitLiters.toFixed(1)} L`;
      case 'requested':
        return `${t.requestedLiters.toFixed(1)} L`;
      case 'approved':
        return `${t.approvedLiters.toFixed(1)} L`;
      case 'dispensed':
        return `${t.dispensedLiters.toFixed(1)} L`;
      case 'state':
        return t.status.toUpperCase();
      default:
        return '—';
    }
  };

  const pdfSummaryItems = getWorkPlanFullReportSummaryItems(workPlan, tickets);
  const orderedReviewSections = getOrderedWorkPlanFullReportSections(
    activeReviewSections,
    pdfSummaryItems.length > 0
  );

  for (const sectionKey of orderedReviewSections) {
    if (sectionKey === 'summaryMetrics' && pdfSummaryItems.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [pdfSummaryItems.map((item) => item.label)],
        body: [pdfSummaryItems.map((item) => item.value)],
        styles: { fontSize: 8.5, cellPadding: 2.5, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
        headStyles: { fillColor: [27, 59, 111], textColor: [255, 255, 255] },
      });
      cursorY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 18) + 7;
    } else if (sectionKey === 'tripTicketsTable') {
      const headers = activeTicketCols.map((k) => ticketHeadMap[k] ?? k);
      const rows = tickets.map((t) => activeTicketCols.map((k) => mapTicketCell(t, k)));
      autoTable(doc, {
        startY: cursorY,
        head: [headers],
        body: rows.length > 0 ? rows : [activeTicketCols.map((_, idx) => (idx === 0 ? 'No embedded trip tickets' : '—'))],
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
      cursorY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 40) + 8;

      if (workPlan.approverNote) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...NAVY);
        doc.text('Tabletop Assessment Note:', 14, cursorY);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...SLATE_TEXT);
        doc.text(workPlan.approverNote, 14, cursorY + 5, { maxWidth: pageWidth - 28 });
        cursorY += 14;
      }
    } else if (sectionKey === 'mandatorySignOffs' && layoutTargets.includeSignOffs) {
      const deptSignOffs = getWorkPlanDepartmentSignOffs(workPlan);
      if (deptSignOffs.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(...NAVY);
        doc.text('DEPARTMENTAL SIGN-OFFS (CONCERNED DEPARTMENT)', 14, cursorY);

        autoTable(doc, {
          startY: cursorY + 3,
          head: [deptSignOffs.map((s) => s.label)],
          body: [deptSignOffs.map((s) => `${s.name}\n(${s.designation})`)],
          styles: { fontSize: 8.5, cellPadding: 4, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
          headStyles: { fillColor: [27, 59, 111], textColor: [255, 255, 255] },
        });
        cursorY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 25) + 6;
      }
    }
  }

  const footerY = pageHeight - 12;
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE_TEXT);
  doc.text(
    'Note: Duly approved trip tickets are valid for single daily dispensing at GSO Fuel Depot. Any unserved balance is automatically forfeited.',
    14,
    footerY
  );

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  const safeFileKey = isSingleTrip
    ? `SingleRequestTicket_${tickets[0]?.ticketNumber || workPlan.id}`
    : workPlan.controlNumber || workPlan.id;

  return {
    title: isSingleTrip ? `${displayRef}${tickets[0]?.ticketNumber ? ` (${tickets[0].ticketNumber})` : ''}` : `Work Plan ${displayRef}`,
    filename: `${safeFileKey}_BaisCity_${isSingleTrip ? 'SingleRequestTicket' : 'WorkPlan'}.pdf`,
    blobUrl,
    doc,
  };
}

export function generateDailyReconciliationPdf(
  report: DailyReconciliationSummary,
  depots: FuelDepot[],
  reportUtilities?: ReportUtilitiesConfig,
  vehicles?: FleetVehicle[]
): GeneratedPdfResult {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const activeSections = getActiveReportUtilityKeys(reportUtilities, 'reports_full_preview');
  const activeDeptCols = getActiveReportUtilityKeys(reportUtilities, 'reports_dept_table');

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

  const deptHeadMap: Record<string, string> = {
    department: 'Dept',
    requestedLiters: 'Req (L)',
    approvedLiters: 'Appr (L)',
    dispensedLiters: 'Disp (L)',
    forfeitedLiters: 'Void (L)',
    costPhp: 'Cost (PHP)',
  };

  let cursorY = 34;

  for (const sectionKey of activeSections) {
    if (sectionKey === 'summaryMetrics') {
      autoTable(doc, {
        startY: cursorY,
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
      cursorY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 20) + 8;
    } else if (sectionKey === 'departmentBreakdown') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...NAVY);
      doc.text('DEPARTMENTAL CONSUMPTION & COST ANALYSIS', 14, cursorY);

      autoTable(doc, {
        startY: cursorY + 3,
        head: [activeDeptCols.map((k) => deptHeadMap[k] ?? k)],
        body: report.departmentBreakdown.map((d) =>
          activeDeptCols.map((k) => {
            switch (k) {
              case 'department':
                return getDepartmentMnemonic(d.department, vehicles);
              case 'requestedLiters':
                return d.requestedLiters.toFixed(1);
              case 'approvedLiters':
                return d.approvedLiters.toFixed(1);
              case 'dispensedLiters':
                return d.dispensedLiters.toFixed(1);
              case 'forfeitedLiters':
                return d.forfeitedLiters.toFixed(1);
              case 'costPhp':
                return d.costPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 });
              default:
                return '—';
            }
          })
        ),
        styles: { fontSize: 8, cellPadding: 2.5, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
        headStyles: { fillColor: NAVY, textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: LIGHT_GRAY_BG },
      });
      cursorY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 45) + 8;
    } else if (sectionKey === 'depotValuation') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...NAVY);
      doc.text('CITY FUEL DEPOT INVENTORY BALANCES', 14, cursorY);

      autoTable(doc, {
        startY: cursorY + 3,
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
      cursorY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 35) + 8;
    } else if (sectionKey === 'discrepancyAlerts') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...NAVY);
      doc.text(`AUTOMATED RECONCILIATION DISCREPANCY ALERTS (${report.alerts.length})`, 14, cursorY);

      autoTable(doc, {
        startY: cursorY + 3,
        head: [['Severity', 'Category', 'Alert Summary']],
        body:
          report.alerts.length > 0
            ? report.alerts.map((a) => [a.severity.toUpperCase(), a.category.replace(/_/g, ' '), `${a.title}: ${a.detail}`])
            : [['NOMINAL', 'None', 'No reconciliation discrepancies detected for this period.']],
        styles: { fontSize: 7.5, cellPadding: 2.5, textColor: NAVY, lineColor: BORDER_GRAY, lineWidth: 0.2 },
        headStyles: { fillColor: [185, 28, 28], textColor: [255, 255, 255] },
      });
      cursorY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 30) + 8;
    }
  }

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
  filterSummary: string,
  vehicles?: FleetVehicle[]
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
      'Tx Code',
      'WP #',
      'Cat',
      'Dept',
      'Plate / Driver',
      'Fuel',
      'Appr (L)',
      'Disp (L)',
      'Needed',
      'Disp At',
      'Proof',
    ]],
    body:
      items.length > 0
        ? items.map(({ ticket: t, workPlanNumber }) => [
            t.ticketNumber,
            t.gsoTransactionCode || 'Pending',
            workPlanNumber,
            t.servedOnce ? 'Dispensed' : 'Approved',
            getDepartmentMnemonic(t.department, vehicles),
            `${t.plateNumber}\n${t.driverName}`,
            t.fuelType.toUpperCase(),
            `${t.approvedLiters.toFixed(1)} L`,
            t.servedOnce ? `${t.dispensedLiters.toFixed(1)} L` : 'Pending',
            t.scheduledDate,
            t.dispensedAt ? t.dispensedAt.slice(0, 16).replace('T', ' ') : 'Pending',
            t.pumpReadingPhotoName || (t.servedOnce ? 'Baseline' : 'Pending'),
          ])
        : [['—', '—', '—', '—', 'No matching records in filtered view', '—', '—', '—', '—', '—', '—', '—']],
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
