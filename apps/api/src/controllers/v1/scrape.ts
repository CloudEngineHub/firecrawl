import { Request, Response } from "express";
import { Logger } from '../../lib/logger';
import { Document, legacyScrapeOptions, RequestWithAuth, ScrapeRequest, scrapeRequestSchema, ScrapeResponse } from "./types";
import { billTeam } from "../../services/billing/credit_billing";
import { v4 as uuidv4 } from 'uuid';
import { numTokensFromString } from "../../lib/LLM-extraction/helpers";
import { addScrapeJob } from "../../services/queue-jobs";
import { scrapeQueueEvents } from '../../services/queue-service';
import { logJob } from "../../services/logging/log_job";

export async function scrapeController(req: RequestWithAuth<ScrapeResponse, ScrapeRequest>, res: Response<ScrapeResponse>) {
  req.body = scrapeRequestSchema.parse(req.body);  
  let earlyReturn = false;

  const origin = req.body.origin;
  const timeout = req.body.timeout;
  const pageOptions = legacyScrapeOptions(req.body);

  const jobId = uuidv4();

  const startTime = new Date().getTime();
  const job = await addScrapeJob({
    url: req.body.url,
    mode: "single_urls",
    crawlerOptions: {},
    team_id: req.auth.team_id,
    pageOptions,
    extractorOptions: {},
    origin: req.body.origin,
  }, {}, jobId);

  let doc: any | undefined;
  try {
    doc = (await job.waitUntilFinished(scrapeQueueEvents, timeout))[0]; // 60 seconds timeout
  } catch (e) {
    Logger.error(`Error in scrapeController: ${e}`);
    if (e instanceof Error && e.message.startsWith("Job wait")) {
      return res.status(408).json({
        success: false,
        error: "Request timed out",
      });
    } else {
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  await job.remove();

  if (!doc) {
    console.error("!!! PANIC DOC IS", doc, job);
    return res.status(200).json({
      success: true,
      warning: "No page found",
      data: doc
    });
  }

  delete doc.index;
  delete doc.provider;

  const endTime = new Date().getTime();
  const timeTakenInSeconds = (endTime - startTime) / 1000;
  const numTokens = (doc && doc.markdown) ? numTokensFromString(doc.markdown, "gpt-3.5-turbo") : 0;

  let creditsToBeBilled = 1; // Assuming 1 credit per document
  if (earlyReturn) {
    // Don't bill if we're early returning
    return;
  }

  const billingResult = await billTeam(
    req.auth.team_id,
    creditsToBeBilled
  );
  if (!billingResult.success) {
    return res.status(402).json({
      success: false,
      error: "Failed to bill team. Insufficient credits or subscription not found.",
    });
  }

  logJob({
    job_id: jobId,
    success: true,
    message: "Scrape completed",
    num_docs: 1,
    docs: [doc],
    time_taken: timeTakenInSeconds,
    team_id: req.auth.team_id,
    mode: "scrape",
    url: req.body.url,
    crawlerOptions: {},
    pageOptions: pageOptions,
    origin: origin, 
    extractor_options: { mode: "markdown" },
    num_tokens: numTokens,
  });

  return res.status(200).json({
    success: true,
    data: {
      markdown: doc.markdown,
      links: doc.linksOnPage,
      rawHtml: doc.rawHtml,
      html: doc.html,
      screenshot: doc.screenshot,
      fullPageScreenshot: doc.fullPageScreenshot,
      metadata: {
        ...doc.metadata,
        pageError: undefined,
        pageStatusCode: undefined,
        error: doc.metadata.pageError,
        statusCode: doc.metadata.pageStatusCode,
      },
    } as Document
  });
}