/* eslint-disable no-await-in-loop, no-restricted-syntax */
import { ElementHandle, Page, PageScreenshotOptions } from 'playwright';
import { PlaywrightBlocker } from '@cliqz/adblocker-playwright';
import fetch from 'cross-fetch';
import path from 'path';

import { EventEmitter } from 'events';
import {
  Where, What, PageState, Workflow, WorkflowFile,
  ParamType, SelectorArray, CustomFunctions,
} from './types/workflow';

import { operators, meta } from './types/logic';
import { arrayToObject } from './utils/utils';
import Concurrency from './utils/concurrency';
import Preprocessor from './preprocessor';
import log, { Level } from './utils/logger';

/**
 * Extending the Window interface for custom scraping functions.
 */
declare global {
  interface Window {
    scrape: (selector: string | null) => Record<string, string>[];
    scrapeSchema: (
      schema: Record<string, { selector: string; tag: string; attribute: string }>
    ) => Record<string, any>;
    scrapeList: (config: { listSelector: string; fields: any; limit?: number; pagination: any }) => Record<string, any>[];
    scrapeListAuto: (listSelector: string) => { selector: string; innerText: string }[];
    scrollDown: (pages?: number) => void;
    scrollUp: (pages?: number) => void;
  }
}


/**
 * Defines optional intepreter options (passed in constructor)
 */
interface InterpreterOptions {
  maxRepeats: number;
  maxConcurrency: number;
  serializableCallback: (output: any) => (void | Promise<void>);
  binaryCallback: (output: any, mimeType: string) => (void | Promise<void>);
  debug: boolean;
  debugChannel: Partial<{
    activeId: Function,
    debugMessage: Function,
  }>
}

/**
 * Class for running the Smart Workflows.
 */
export default class Interpreter extends EventEmitter {
  private workflow: Workflow;

  private initializedWorkflow: Workflow | null;

  private options: InterpreterOptions;

  private concurrency: Concurrency;

  private stopper: Function | null = null;

  private log: typeof log;

  private blocker: PlaywrightBlocker | null = null;

  private cumulativeResults: Record<string, any>[] = [];

  constructor(workflow: WorkflowFile, options?: Partial<InterpreterOptions>) {
    super();
    this.workflow = workflow.workflow;
    this.initializedWorkflow = null;
    this.options = {
      maxRepeats: 5,
      maxConcurrency: 5,
      serializableCallback: (data) => { 
        log(JSON.stringify(data), Level.WARN);
      },
      binaryCallback: () => { log('Received binary data, thrashing them.', Level.WARN); },
      debug: false,
      debugChannel: {},
      ...options,
    };
    this.concurrency = new Concurrency(this.options.maxConcurrency);
    this.log = (...args) => log(...args);

    const error = Preprocessor.validateWorkflow(workflow);
    if (error) {
      throw (error);
    }

    if (this.options.debugChannel?.debugMessage) {
      const oldLog = this.log;
      // @ts-ignore
      this.log = (...args: Parameters<typeof oldLog>) => {
        if (args[1] !== Level.LOG) {
          this.options.debugChannel.debugMessage!(typeof args[0] === 'string' ? args[0] : args[0].message);
        }
        oldLog(...args);
      };
    }

    PlaywrightBlocker.fromLists(fetch, ['https://easylist.to/easylist/easylist.txt']).then(blocker => {
      this.blocker = blocker;
    }).catch(err => {
      this.log(`Failed to initialize ad-blocker:`, Level.ERROR);
    })
  }

  private async applyAdBlocker(page: Page): Promise<void> {
    if (this.blocker) {
      try {
        await this.blocker.enableBlockingInPage(page);
      } catch (err) {
        this.log(`Ad-blocker operation failed:`, Level.ERROR);
      }
    }
  }

  private async disableAdBlocker(page: Page): Promise<void> {
    if (this.blocker) {
      try {
        await this.blocker.disableBlockingInPage(page);
      } catch (err) {
        this.log(`Ad-blocker operation failed:`, Level.ERROR);
      }
    }
  }

  // private getSelectors(workflow: Workflow, actionId: number): string[] {
  //   const selectors: string[] = [];

  //   // Validate actionId
  //   if (actionId <= 0) {
  //       console.log("No previous selectors to collect.");
  //       return selectors; // Empty array as there are no previous steps
  //   }

  //   // Iterate from the start up to (but not including) actionId
  //   for (let index = 0; index < actionId; index++) {
  //       const currentSelectors = workflow[index]?.where?.selectors;
  //       console.log(`Selectors at step ${index}:`, currentSelectors);

  //       if (currentSelectors && currentSelectors.length > 0) {
  //           currentSelectors.forEach((selector) => {
  //               if (!selectors.includes(selector)) {
  //                   selectors.push(selector); // Avoid duplicates
  //               }
  //           });
  //       }
  //   }

  //   console.log("Collected Selectors:", selectors);
  //   return selectors;
  // }

  private getSelectors(workflow: Workflow): string[] {
    const selectorsSet = new Set<string>();

    if (workflow.length === 0) {
        return [];
    }

    for (let index = workflow.length - 1; index >= 0; index--) {
        const currentSelectors = workflow[index]?.where?.selectors;

        if (currentSelectors && currentSelectors.length > 0) {
            currentSelectors.forEach((selector) => selectorsSet.add(selector));
            return Array.from(selectorsSet);
        }
    }

    return [];
  }


  /**
    * Returns the context object from given Page and the current workflow.\
    * \
    * `workflow` is used for selector extraction - function searches for used selectors to
    * look for later in the page's context.
    * @param page Playwright Page object
    * @param workflow Current **initialized** workflow (array of where-what pairs).
    * @returns {PageState} State of the current page.
    */
  private async getState(page: Page, workflowCopy: Workflow, selectors: string[]): Promise<PageState> {
    /**
     * All the selectors present in the current Workflow
     */
    // const selectors = Preprocessor.extractSelectors(workflow);
    // console.log("Current selectors:", selectors);

    /**
      * Determines whether the element targetted by the selector is [actionable](https://playwright.dev/docs/actionability).
      * @param selector Selector to be queried
      * @returns True if the targetted element is actionable, false otherwise.
      */
    // const actionable = async (selector: string): Promise<boolean> => {
    //   try {
    //     const proms = [
    //       page.isEnabled(selector, { timeout: 10000 }),
    //       page.isVisible(selector, { timeout: 10000 }),
    //     ];

    //     return await Promise.all(proms).then((bools) => bools.every((x) => x));
    //   } catch (e) {
    //     // log(<Error>e, Level.ERROR);
    //     return false;
    //   }
    // };

    /**
      * Object of selectors present in the current page.
      */
    // const presentSelectors: SelectorArray = await Promise.all(
    //   selectors.map(async (selector) => {
    //     if (await actionable(selector)) {
    //       return [selector];
    //     }
    //     return [];
    //   }),
    // ).then((x) => x.flat());

    const presentSelectors: SelectorArray = await Promise.all(
        selectors.map(async (selector) => {
            try {
                await page.waitForSelector(selector, { state: 'attached' });
                return [selector];
            } catch (e) {
                return [];
            }
        }),
    ).then((x) => x.flat());
    
    const action = workflowCopy[workflowCopy.length - 1];

    // console.log("Next action:", action)

    let url: any = page.url();

    if (action && action.where.url !== url && action.where.url !== "about:blank") {
      url = action.where.url;
    }

    return {
      url,
      cookies: (await page.context().cookies([page.url()]))
        .reduce((p, cookie) => (
          {
            ...p,
            [cookie.name]: cookie.value,
          }), {}),
      selectors: presentSelectors,
    };
  }

  /**
   * Tests if the given action is applicable with the given context.
   * @param where Tested *where* condition
   * @param context Current browser context.
   * @returns True if `where` is applicable in the given context, false otherwise
   */
  private applicable(where: Where, context: PageState, usedActions: string[] = []): boolean {
    /**
     * Given two arbitrary objects, determines whether `subset` is a subset of `superset`.\
     * \
     * For every key in `subset`, there must be a corresponding key with equal scalar
     * value in `superset`, or `inclusive(subset[key], superset[key])` must hold.
     * @param subset Arbitrary non-cyclic JS object (where clause)
     * @param superset Arbitrary non-cyclic JS object (browser context)
     * @returns `true` if `subset <= superset`, `false` otherwise.
     */
    const inclusive = (subset: Record<string, unknown>, superset: Record<string, unknown>)
      : boolean => (
      Object.entries(subset).every(
        ([key, value]) => {
          /**
           * Arrays are compared without order (are transformed into objects before comparison).
           */
          const parsedValue = Array.isArray(value) ? arrayToObject(value) : value;

          const parsedSuperset: Record<string, unknown> = {};
          parsedSuperset[key] = Array.isArray(superset[key])
            ? arrayToObject(<any>superset[key])
            : superset[key];

          if ((key === 'url' || key === 'selectors') && 
            Array.isArray(value) && Array.isArray(superset[key]) && 
            value.length === 0 && (superset[key] as any[]).length === 0) {
            return true;
          }

          if (key === 'selectors' && Array.isArray(value) && Array.isArray(superset[key])) {
            return value.some(selector => 
              (superset[key] as any[]).includes(selector)
            );
          }

          // Every `subset` key must exist in the `superset` and
          // have the same value (strict equality), or subset[key] <= superset[key]
          return parsedSuperset[key]
            && (
              (parsedSuperset[key] === parsedValue)
              || ((parsedValue).constructor.name === 'RegExp' && (<RegExp>parsedValue).test(<string>parsedSuperset[key]))
              || (
                (parsedValue).constructor.name !== 'RegExp'
                && typeof parsedValue === 'object' && inclusive(<typeof subset>parsedValue, <typeof superset>parsedSuperset[key])
              )
            );
        },
      )
    );

    // Every value in the "where" object should be compliant to the current state.
    return Object.entries(where).every(
      ([key, value]) => {
        if (operators.includes(<any>key)) {
          const array = Array.isArray(value)
            ? value as Where[]
            : Object.entries(value).map((a) => Object.fromEntries([a]));
          // every condition is treated as a single context

          switch (key as keyof typeof operators) {
            case '$and' as keyof typeof operators:
              return array?.every((x) => this.applicable(x, context));
            case '$or' as keyof typeof operators:
              return array?.some((x) => this.applicable(x, context));
            case '$not' as keyof typeof operators:
              return !this.applicable(<Where>value, context); // $not should be a unary operator
            default:
              throw new Error('Undefined logic operator.');
          }
        } else if (meta.includes(<any>key)) {
          const testRegexString = (x: string) => {
            if (typeof value === 'string') {
              return x === value;
            }

            return (<RegExp><unknown>value).test(x);
          };

          switch (key as keyof typeof meta) {
            case '$before' as keyof typeof meta:
              return !usedActions.find(testRegexString);
            case '$after' as keyof typeof meta:
              return !!usedActions.find(testRegexString);
            default:
              throw new Error('Undefined meta operator.');
          }
        } else {
          // Current key is a base condition (url, cookies, selectors)
          return inclusive({ [key]: value }, context);
        }
      },
    );
  }

  /**
 * Given a Playwright's page object and a "declarative" list of actions, this function
 * calls all mentioned functions on the Page object.\
 * \
 * Manipulates the iterator indexes (experimental feature, likely to be removed in
 * the following versions of maxun-core)
 * @param page Playwright Page object
 * @param steps Array of actions.
 */
  private async carryOutSteps(page: Page, steps: What[]): Promise<void> {
    /**
     * Defines overloaded (or added) methods/actions usable in the workflow.
     * If a method overloads any existing method of the Page class, it accepts the same set
     * of parameters *(but can override some!)*\
     * \
     * Also, following piece of code defines functions to be run in the browser's context.
     * Beware of false linter errors - here, we know better!
     */
    const wawActions: Record<CustomFunctions, (...args: any[]) => void> = {
      screenshot: async (params: PageScreenshotOptions) => {
        const screenshotBuffer = await page.screenshot({
          ...params, path: undefined,
        });
        await this.options.binaryCallback(screenshotBuffer, 'image/png');
      },
      enqueueLinks: async (selector: string) => {
        const links: string[] = await page.locator(selector)
          .evaluateAll(
            // @ts-ignore
            (elements) => elements.map((a) => a.href).filter((x) => x),
          );
        const context = page.context();

        for (const link of links) {
          // eslint-disable-next-line
          this.concurrency.addJob(async () => {
            try {
              const newPage = await context.newPage();
              await newPage.goto(link);
              await newPage.waitForLoadState('networkidle');
              await this.runLoop(newPage, this.initializedWorkflow!);
            } catch (e) {
              // `runLoop` uses soft mode, so it recovers from it's own exceptions
              // but newPage(), goto() and waitForLoadState() don't (and will kill
              // the interpreter by throwing).
              this.log(<Error>e, Level.ERROR);
            }
          });
        }
        await page.close();
      },
      scrape: async (selector?: string) => {
        await this.ensureScriptsLoaded(page);

        const scrapeResults: Record<string, string>[] = await page.evaluate((s) => window.scrape(s ?? null), selector);
        await this.options.serializableCallback(scrapeResults);
      },

      scrapeSchema: async (schema: Record<string, { selector: string; tag: string, attribute: string; shadow: string}>) => {
        await this.ensureScriptsLoaded(page);
      
        const scrapeResult = await page.evaluate((schemaObj) => window.scrapeSchema(schemaObj), schema);
      
        const newResults = Array.isArray(scrapeResult) ? scrapeResult : [scrapeResult];
        newResults.forEach((result) => {
          Object.entries(result).forEach(([key, value]) => {
              const keyExists = this.cumulativeResults.some(
                  (item) => key in item && item[key] !== undefined
              );
  
              if (!keyExists) {
                  this.cumulativeResults.push({ [key]: value });
              }
          });
        });

        const mergedResult: Record<string, string>[] = [
          Object.fromEntries( 
            Object.entries(
              this.cumulativeResults.reduce((acc, curr) => {
                Object.entries(curr).forEach(([key, value]) => {
                  // If the key doesn't exist or the current value is not undefined, add/update it
                  if (value !== undefined) {
                    acc[key] = value;
                  }
                });
                return acc;
              }, {})
            )
          )
        ];

        // Log cumulative results after each action
        console.log("CUMULATIVE results:", this.cumulativeResults);
        console.log("MERGED results:", mergedResult);

        await this.options.serializableCallback(mergedResult);
        // await this.options.serializableCallback(scrapeResult);
      },

      scrapeList: async (config: { listSelector: string, fields: any, limit?: number, pagination: any }) => {
        await this.ensureScriptsLoaded(page);
        if (!config.pagination) {
          const scrapeResults: Record<string, any>[] = await page.evaluate((cfg) => window.scrapeList(cfg), config);
          await this.options.serializableCallback(scrapeResults);
        } else {
          const scrapeResults: Record<string, any>[] = await this.handlePagination(page, config);
          await this.options.serializableCallback(scrapeResults);
        }
      },

      scrapeListAuto: async (config: { listSelector: string }) => {
        await this.ensureScriptsLoaded(page);

        const scrapeResults: { selector: string, innerText: string }[] = await page.evaluate((listSelector) => {
          return window.scrapeListAuto(listSelector);
        }, config.listSelector);

        await this.options.serializableCallback(scrapeResults);
      },

      scroll: async (pages?: number) => {
        await page.evaluate(async (pagesInternal) => {
          for (let i = 1; i <= (pagesInternal ?? 1); i += 1) {
            // @ts-ignore
            window.scrollTo(0, window.scrollY + window.innerHeight);
          }
        }, pages ?? 1);
      },

      script: async (code: string) => {
        const AsyncFunction: FunctionConstructor = Object.getPrototypeOf(
          async () => { },
        ).constructor;
        const x = new AsyncFunction('page', 'log', code);
        await x(page, this.log);
      },

      flag: async () => new Promise((res) => {
        this.emit('flag', page, res);
      }),
    };

    const executeAction = async (invokee: any, methodName: string, args: any) => {
      console.log("Executing action:", methodName, args);

      if (methodName === 'press' || methodName === 'type') {
        // Extract only the first two arguments for these methods
        const limitedArgs = Array.isArray(args) ? args.slice(0, 2) : [args];
        await (<any>invokee[methodName])(...limitedArgs);
        return;
      }

      if (!args || Array.isArray(args)) {
        await (<any>invokee[methodName])(...(args ?? []));
      } else {
        await (<any>invokee[methodName])(args);
      }
    };
    

    for (const step of steps) {
      this.log(`Launching ${String(step.action)}`, Level.LOG);

      if (step.action in wawActions) {
        // "Arrayifying" here should not be needed (TS + syntax checker - only arrays; but why not)
        const params = !step.args || Array.isArray(step.args) ? step.args : [step.args];
        await wawActions[step.action as CustomFunctions](...(params ?? []));
      } else {
        // Implements the dot notation for the "method name" in the workflow
        const levels = String(step.action).split('.');
        const methodName = levels[levels.length - 1];

        let invokee: any = page;
        for (const level of levels.splice(0, levels.length - 1)) {
          invokee = invokee[level];
        }

        if (methodName === 'waitForLoadState') {
          try {
            await executeAction(invokee, methodName, step.args);
          } catch (error) {
            await executeAction(invokee, methodName, 'domcontentloaded');
          }
        } else if (methodName === 'click') {
          try {
            await executeAction(invokee, methodName, step.args);
          } catch (error) {
            try{
              await executeAction(invokee, methodName, [step.args[0], { force: true }]);
            } catch (error) {
              continue
            }
          }
        } else {
          await executeAction(invokee, methodName, step.args);
        }
      }

      await new Promise((res) => { setTimeout(res, 500); });
    }
  }

  private async handlePagination(page: Page, config: { 
    listSelector: string, 
    fields: any, 
    limit?: number, 
    pagination: any 
}) {
    let allResults: Record<string, any>[] = [];
    let previousHeight = 0;
    let scrapedItems: Set<string> = new Set<string>();
    let visitedUrls: Set<string> = new Set<string>();
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second delay between retries

    const debugLog = (message: string, ...args: any[]) => {
        console.log(`[Page ${visitedUrls.size}] [URL: ${page.url()}] ${message}`, ...args);
    };

    const scrapeCurrentPage = async () => {
        const results = await page.evaluate((cfg) => window.scrapeList(cfg), config);
        const newResults = results.filter(item => {
            const uniqueKey = JSON.stringify(item);
            if (scrapedItems.has(uniqueKey)) return false;
            scrapedItems.add(uniqueKey);
            return true;
        });
        allResults = allResults.concat(newResults);
        debugLog("Results collected:", allResults.length);
    };

    const checkLimit = () => {
        if (config.limit && allResults.length >= config.limit) {
            allResults = allResults.slice(0, config.limit);
            return true;
        }
        return false;
    };

    // Enhanced button finder with retry mechanism
    const findWorkingButton = async (selectors: string[]): Promise<{ 
      button: ElementHandle | null, 
      workingSelector: string | null,
      updatedSelectors: string[]
    }> => {
      let updatedSelectors = [...selectors]; 
      
      for (let i = 0; i < selectors.length; i++) {
        const selector = selectors[i];
        let retryCount = 0;
        let selectorSuccess = false;
        
        while (retryCount < MAX_RETRIES && !selectorSuccess) {
          try {
            const button = await page.waitForSelector(selector, {
              state: 'attached',
              timeout: 10000 
            });
            
            if (button) {
              debugLog('Found working selector:', selector);
              return { 
                button, 
                workingSelector: selector,
                updatedSelectors 
              };
            }
          } catch (error) {
            retryCount++;
            debugLog(`Selector "${selector}" failed: attempt ${retryCount}/${MAX_RETRIES}`);
            
            if (retryCount < MAX_RETRIES) {
              await page.waitForTimeout(RETRY_DELAY);
            } else {
              debugLog(`Removing failed selector "${selector}" after ${MAX_RETRIES} attempts`);
              updatedSelectors = updatedSelectors.filter(s => s !== selector);
            }
          }
        }
      }
    
      return { 
        button: null, 
        workingSelector: null,
        updatedSelectors 
      };
    };

    const retryOperation = async (operation: () => Promise<boolean>, retryCount = 0): Promise<boolean> => {
        try {
            return await operation();
        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                debugLog(`Retrying operation. Attempt ${retryCount + 1} of ${MAX_RETRIES}`);
                await page.waitForTimeout(RETRY_DELAY);
                return retryOperation(operation, retryCount + 1);
            }
            debugLog(`Operation failed after ${MAX_RETRIES} retries`);
            return false;
        }
    };

    let availableSelectors = config.pagination.selector.split(',');

    try {
      while (true) {    
        switch (config.pagination.type) {
          case 'scrollDown': {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(2000);

            const currentHeight = await page.evaluate(() => document.body.scrollHeight);
            if (currentHeight === previousHeight) {
              const finalResults = await page.evaluate((cfg) => window.scrapeList(cfg), config);
              allResults = allResults.concat(finalResults);
              return allResults;
            }

            previousHeight = currentHeight;
            break;
          }

          case 'scrollUp': {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(2000);

            const currentTopHeight = await page.evaluate(() => document.documentElement.scrollTop);
            if (currentTopHeight === 0) {
              const finalResults = await page.evaluate((cfg) => window.scrapeList(cfg), config);
              allResults = allResults.concat(finalResults);
              return allResults;
            }

            previousHeight = currentTopHeight;
            break;
          }

          case 'clickNext': {
            const currentUrl = page.url();
            visitedUrls.add(currentUrl);
            
            await scrapeCurrentPage();
            if (checkLimit()) return allResults;
          
            const { button, workingSelector, updatedSelectors } = await findWorkingButton(availableSelectors);
            
            availableSelectors = updatedSelectors;
          
            if (!button || !workingSelector) {
              // Final retry for navigation when no selectors work
              const success = await retryOperation(async () => {
                try {
                  await page.evaluate(() => window.history.forward());
                  const newUrl = page.url();
                  return !visitedUrls.has(newUrl);
                } catch {
                  return false;
                }
              });
                
              if (!success) return allResults;
              break;
            }
          
            let retryCount = 0;
            let paginationSuccess = false;
            
            // Capture basic content signature before click
            const captureContentSignature = async () => {
              return await page.evaluate((selector) => {
                const items = document.querySelectorAll(selector);
                return {
                  url: window.location.href,
                  itemCount: items.length,
                  firstItems: Array.from(items).slice(0, 3).map(el => el.textContent || '').join('|')
                };
              }, config.listSelector);
            };
          
            const beforeSignature = await captureContentSignature();
            debugLog(`Before click: ${beforeSignature.itemCount} items`);
          
            while (retryCount < MAX_RETRIES && !paginationSuccess) {
              try {
                try {
                  await Promise.all([
                    page.waitForNavigation({ 
                      waitUntil: 'networkidle',
                      timeout: 15000 
                    }).catch(e => {
                      throw e; 
                    }),
                    button.click()
                  ]);
                  debugLog("Navigation successful after regular click");
                  paginationSuccess = true;
                } catch (navError) {
                  debugLog("Regular click with navigation failed, trying dispatch event with navigation");
                  try {
                    await Promise.all([
                      page.waitForNavigation({ 
                        waitUntil: 'networkidle',
                        timeout: 15000 
                      }).catch(e => {
                        throw e; 
                      }),
                      button.dispatchEvent('click')
                    ]);
                    debugLog("Navigation successful after dispatch event");
                    paginationSuccess = true;
                  } catch (dispatchNavError) {
                    try {
                      await button.click();
                      await page.waitForTimeout(2000);
                    } catch (clickError) {
                      await button.dispatchEvent('click');
                      await page.waitForTimeout(2000);
                    }
                  }
                }
                
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
                
                if (!paginationSuccess) {
                  const newUrl = page.url();
                  const afterSignature = await captureContentSignature();
                  
                  if (newUrl !== currentUrl) {
                    debugLog(`URL changed to ${newUrl}`);
                    visitedUrls.add(newUrl);
                    paginationSuccess = true;
                  } 
                  else if (afterSignature.firstItems !== beforeSignature.firstItems) {
                    debugLog("Content changed without URL change");
                    paginationSuccess = true;
                  }
                  else if (afterSignature.itemCount !== beforeSignature.itemCount) {
                    debugLog(`Item count changed from ${beforeSignature.itemCount} to ${afterSignature.itemCount}`);
                    paginationSuccess = true;
                  }
                }
              } catch (error) {
                debugLog(`Pagination attempt ${retryCount + 1} failed: ${error.message}`);
              }
              
              if (!paginationSuccess) {
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                  debugLog(`Retrying pagination - attempt ${retryCount + 1} of ${MAX_RETRIES}`);
                  await page.waitForTimeout(RETRY_DELAY);
                }
              }
            }
          
            if (!paginationSuccess) {
              debugLog(`Pagination failed after ${MAX_RETRIES} attempts`);
              return allResults;
            }
            
            break;
          }

          case 'clickLoadMore': {
            await scrapeCurrentPage();
            if (checkLimit()) return allResults;
            
            let loadMoreCounter = 0;
            let previousResultCount = allResults.length;
            let noNewItemsCounter = 0;
            const MAX_NO_NEW_ITEMS = 2;
            
            while (true) {
              // Find working button with retry mechanism
              const { button: loadMoreButton, workingSelector, updatedSelectors } = await findWorkingButton(availableSelectors);

              availableSelectors = updatedSelectors;
              
              if (!workingSelector || !loadMoreButton) {
                debugLog('No working Load More selector found after retries');
                return allResults;
              }
          
              // Implement retry mechanism for clicking the button
              let retryCount = 0;
              let clickSuccess = false;
          
              while (retryCount < MAX_RETRIES && !clickSuccess) {
                try {
                  try {
                    await loadMoreButton.click();
                    clickSuccess = true;
                  } catch (error) {
                    debugLog(`Regular click failed on attempt ${retryCount + 1}. Trying DispatchEvent`);
                    
                    // If regular click fails, try dispatchEvent
                    try {
                      await loadMoreButton.dispatchEvent('click');
                      clickSuccess = true;
                    } catch (dispatchError) {
                      debugLog(`DispatchEvent failed on attempt ${retryCount + 1}.`);
                      throw dispatchError; // Propagate error to trigger retry
                    }
                  }
          
                  if (clickSuccess) {
                    await page.waitForTimeout(1000);
                    loadMoreCounter++;
                    debugLog(`Successfully clicked Load More button (${loadMoreCounter} times)`);
                  }
                } catch (error) {
                  debugLog(`Click attempt ${retryCount + 1} failed completely.`);
                  retryCount++;
                  
                  if (retryCount < MAX_RETRIES) {
                    debugLog(`Retrying click - attempt ${retryCount + 1} of ${MAX_RETRIES}`);
                    await page.waitForTimeout(RETRY_DELAY);
                  }
                }
              }
          
              if (!clickSuccess) {
                debugLog(`Load More clicking failed after ${MAX_RETRIES} attempts`);
                return allResults;
              }
          
              // Wait for content to load and check scroll height
              await page.waitForTimeout(2000);
              await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
              await page.waitForTimeout(2000);
          
              const currentHeight = await page.evaluate(() => document.body.scrollHeight);
              const heightChanged = currentHeight !== previousHeight;
              previousHeight = currentHeight;
              
              await scrapeCurrentPage();
              
              const currentResultCount = allResults.length;
              const newItemsAdded = currentResultCount > previousResultCount;
                          
              if (!newItemsAdded) {
                noNewItemsCounter++;
                debugLog(`No new items added after click (${noNewItemsCounter}/${MAX_NO_NEW_ITEMS})`);
                
                if (noNewItemsCounter >= MAX_NO_NEW_ITEMS) {
                  debugLog(`Stopping after ${MAX_NO_NEW_ITEMS} clicks with no new items`);
                  return allResults;
                }
              } else {
                noNewItemsCounter = 0;
                previousResultCount = currentResultCount;
              }
              
              if (checkLimit()) return allResults;     
              
              if (!heightChanged) {
                debugLog('No more items loaded after Load More');
                return allResults;
              }
            }
          }

          default: {
            await scrapeCurrentPage();
            return allResults;
          }
        }

        if (checkLimit()) break;
      }
    } catch (error) {
        debugLog(`Fatal error: ${error.message}`);
        return allResults;
    }

    return allResults;
  }

  private getMatchingActionId(workflow: Workflow, pageState: PageState, usedActions: string[]) {
    for (let actionId = workflow.length - 1; actionId >= 0; actionId--) {
      const step = workflow[actionId];
      const isApplicable = this.applicable(step.where, pageState, usedActions);
      console.log("-------------------------------------------------------------");
      console.log(`Where:`, step.where);
      console.log(`Page state:`, pageState);
      console.log(`Match result: ${isApplicable}`);
      console.log("-------------------------------------------------------------");
      
      if (isApplicable) {
          return actionId;
      }
    }
  }

  private removeShadowSelectors(workflow: Workflow) {
    for (let actionId = workflow.length - 1; actionId >= 0; actionId--) {
      const step = workflow[actionId];
      
      // Check if step has where and selectors
      if (step.where && Array.isArray(step.where.selectors)) {
          // Filter out selectors that contain ">>"
          step.where.selectors = step.where.selectors.filter(selector => !selector.includes('>>'));
      }
    }
  
    return workflow;
  }

  private removeSpecialSelectors(workflow: Workflow) {
    for (let actionId = workflow.length - 1; actionId >= 0; actionId--) {
        const step = workflow[actionId];
        
        if (step.where && Array.isArray(step.where.selectors)) {
            // Filter out if selector has EITHER ":>>" OR ">>"
            step.where.selectors = step.where.selectors.filter(selector => 
                !(selector.includes(':>>') || selector.includes('>>'))
            );
        }
    }

    return workflow;
  }

  private async runLoop(p: Page, workflow: Workflow) {
    let workflowCopy: Workflow = JSON.parse(JSON.stringify(workflow));

    workflowCopy = this.removeSpecialSelectors(workflowCopy);

    // apply ad-blocker to the current page
    try {
      await this.applyAdBlocker(p);
    } catch (error) {
      this.log(`Failed to apply ad-blocker: ${error.message}`, Level.ERROR);
    }
    const usedActions: string[] = [];
    let selectors: string[] = [];
    let lastAction = null;
    let actionId = -1
    let repeatCount = 0;

    /**
    *  Enables the interpreter functionality for popup windows.
    * User-requested concurrency should be entirely managed by the concurrency manager,
    * e.g. via `enqueueLinks`.
    */
    p.on('popup', (popup) => {
      this.concurrency.addJob(() => this.runLoop(popup, workflowCopy));
    });

    /* eslint no-constant-condition: ["warn", { "checkLoops": false }] */
    while (true) {
      // Checks whether the page was closed from outside,
      //  or the workflow execution has been stopped via `interpreter.stop()`
      if (p.isClosed() || !this.stopper) {
        return;
      }

      try {
        await p.waitForLoadState();
      } catch (e) {
        await p.close();
        return;
      }

      let pageState = {};
      let getStateTest = "Hello";
      try {
        pageState = await this.getState(p, workflowCopy, selectors);
        selectors = [];
        console.log("Empty selectors:", selectors)
      } catch (e: any) {
        this.log('The browser has been closed.');
        return;
      }

      if (this.options.debug) {
        this.log(`Current state is: \n${JSON.stringify(pageState, null, 2)}`, Level.WARN);
      }

      // const actionId = workflow.findIndex((step) => {
      //   const isApplicable = this.applicable(step.where, pageState, usedActions);
      //   console.log("-------------------------------------------------------------");
      //   console.log(`Where:`, step.where);
      //   console.log(`Page state:`, pageState);
      //   console.log(`Match result: ${isApplicable}`);
      //   console.log("-------------------------------------------------------------");
      //   return isApplicable;
      // });

      actionId = this.getMatchingActionId(workflowCopy, pageState, usedActions);

      const action = workflowCopy[actionId];

      console.log("MATCHED ACTION:", action);
      console.log("MATCHED ACTION ID:", actionId);
      this.log(`Matched ${JSON.stringify(action?.where)}`, Level.LOG);

      if (action) { // action is matched
        if (this.options.debugChannel?.activeId) {
          this.options.debugChannel.activeId(actionId);
        }
        
        repeatCount = action === lastAction ? repeatCount + 1 : 0;
        
        console.log("REPEAT COUNT", repeatCount);
        if (this.options.maxRepeats && repeatCount > this.options.maxRepeats) {
          return;
        }
        lastAction = action;
        
        try {
          console.log("Carrying out:", action.what);
          await this.carryOutSteps(p, action.what);
          usedActions.push(action.id ?? 'undefined');

          workflowCopy.splice(actionId, 1);
          console.log(`Action with ID ${action.id} removed from the workflow copy.`);
          
          // const newSelectors = this.getPreviousSelectors(workflow, actionId);
          const newSelectors = this.getSelectors(workflowCopy);
          newSelectors.forEach(selector => {
              if (!selectors.includes(selector)) {
                  selectors.push(selector);
              }
          });
        } catch (e) {
          this.log(<Error>e, Level.ERROR);
        }
      } else {
        //await this.disableAdBlocker(p);
        return;
      }
    }
  }

  private async ensureScriptsLoaded(page: Page) {
    const isScriptLoaded = await page.evaluate(() => typeof window.scrape === 'function' && typeof window.scrapeSchema === 'function' && typeof window.scrapeList === 'function' && typeof window.scrapeListAuto === 'function' && typeof window.scrollDown === 'function' && typeof window.scrollUp === 'function');
    if (!isScriptLoaded) {
      await page.addInitScript({ path: path.join(__dirname, 'browserSide', 'scraper.js') });
    }
  }

  /**
   * Spawns a browser context and runs given workflow.
   * \
   * Resolves after the playback is finished.
   * @param {Page} [page] Page to run the workflow on.
   * @param {ParamType} params Workflow specific, set of parameters
   *  for the `{$param: nameofparam}` fields.
   */
  public async run(page: Page, params?: ParamType): Promise<void> {
    this.log('Starting the workflow.', Level.LOG);
    const context = page.context();

    page.setDefaultNavigationTimeout(100000);
    
    // Check proxy settings from context options
    const contextOptions = (context as any)._options;
    const hasProxy = !!contextOptions?.proxy;
    
    this.log(`Proxy settings: ${hasProxy ? `Proxy is configured...` : 'No proxy configured...'}`);
    
    if (hasProxy) {
        if (contextOptions.proxy.username) {
            this.log(`Proxy authenticated...`);
        }
    }
    if (this.stopper) {
      throw new Error('This Interpreter is already running a workflow. To run another workflow, please, spawn another Interpreter.');
    }
    /**
     * `this.workflow` with the parameters initialized.
     */
    this.initializedWorkflow = Preprocessor.initWorkflow(this.workflow, params);

    await this.ensureScriptsLoaded(page);

    this.stopper = () => {
      this.stopper = null;
    };

    this.concurrency.addJob(() => this.runLoop(page, this.initializedWorkflow!));

    await this.concurrency.waitForCompletion();

    this.stopper = null;
  }

  public async stop(): Promise<void> {
    if (this.stopper) {
      await this.stopper();
      this.stopper = null;
    } else {
      throw new Error('Cannot stop, there is no running workflow!');
    }
  }
}