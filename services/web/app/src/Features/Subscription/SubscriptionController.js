const SessionManager = require('../Authentication/SessionManager')
const SubscriptionHandler = require('./SubscriptionHandler')
const PlansLocator = require('./PlansLocator')
const SubscriptionViewModelBuilder = require('./SubscriptionViewModelBuilder')
const LimitationsManager = require('./LimitationsManager')
const RecurlyWrapper = require('./RecurlyWrapper')
const Settings = require('@overleaf/settings')
const logger = require('@overleaf/logger')
const GeoIpLookup = require('../../infrastructure/GeoIpLookup')
const FeaturesUpdater = require('./FeaturesUpdater')
const planFeatures = require('./planFeatures')
const plansV2Config = require('./plansV2Config')
const GroupPlansData = require('./GroupPlansData')
const V1SubscriptionManager = require('./V1SubscriptionManager')
const Errors = require('../Errors/Errors')
const HttpErrorHandler = require('../Errors/HttpErrorHandler')
const SubscriptionErrors = require('./Errors')
const AnalyticsManager = require('../Analytics/AnalyticsManager')
const RecurlyEventHandler = require('./RecurlyEventHandler')
const { expressify } = require('../../util/promises')
const OError = require('@overleaf/o-error')
const SplitTestHandler = require('../SplitTests/SplitTestHandler')
const SubscriptionHelper = require('./SubscriptionHelper')
const interstitialPaymentConfig = require('./interstitialPaymentConfig')

const groupPlanModalOptions = Settings.groupPlanModalOptions
const validGroupPlanModalOptions = {
  plan_code: groupPlanModalOptions.plan_codes.map(item => item.code),
  currency: groupPlanModalOptions.currencies.map(item => item.code),
  size: groupPlanModalOptions.sizes,
  usage: groupPlanModalOptions.usages.map(item => item.code),
}

async function plansPage(req, res) {
  const plans = SubscriptionViewModelBuilder.buildPlansList()

  let recommendedCurrency
  if (req.query.currency) {
    const queryCurrency = req.query.currency.toUpperCase()
    if (GeoIpLookup.isValidCurrencyParam(queryCurrency)) {
      recommendedCurrency = queryCurrency
    }
  }
  if (!recommendedCurrency) {
    const currencyLookup = await GeoIpLookup.promises.getCurrencyCode(
      (req.query ? req.query.ip : undefined) || req.ip
    )
    recommendedCurrency = currencyLookup.currencyCode
  }

  function getDefault(param, category, defaultValue) {
    const v = req.query && req.query[param]
    if (v && validGroupPlanModalOptions[category].includes(v)) {
      return v
    }
    return defaultValue
  }
  const newPlansPageAssignmentV2 =
    await SplitTestHandler.promises.getAssignment(
      req,
      res,
      'plans-page-layout-v2-annual'
    )

  const newPlansPageVariantV2 =
    newPlansPageAssignmentV2 &&
    newPlansPageAssignmentV2.variant === 'new-plans-page'

  let defaultGroupPlanModalCurrency = 'USD'
  if (validGroupPlanModalOptions.currency.includes(recommendedCurrency)) {
    defaultGroupPlanModalCurrency = recommendedCurrency
  }
  const groupPlanModalDefaults = {
    plan_code: getDefault('plan', 'plan_code', 'collaborator'),
    size: getDefault('number', 'size', newPlansPageVariantV2 ? '2' : '10'),
    currency: getDefault('currency', 'currency', defaultGroupPlanModalCurrency),
    usage: getDefault('usage', 'usage', 'enterprise'),
  }

  AnalyticsManager.recordEventForSession(req.session, 'plans-page-view')

  const standardPlanNameAssignment =
    await SplitTestHandler.promises.getAssignment(
      req,
      res,
      'standard-plan-name'
    )

  const useNewPlanName =
    standardPlanNameAssignment &&
    standardPlanNameAssignment.variant === 'new-plan-name'

  const template = newPlansPageVariantV2
    ? 'subscriptions/plans-marketing-v2'
    : 'subscriptions/plans-marketing'

  res.render(template, {
    title: 'plans_and_pricing',
    plans,
    itm_content: req.query && req.query.itm_content,
    itm_campaign: 'plans',
    recommendedCurrency,
    planFeatures,
    plansV2Config,
    groupPlans: GroupPlansData,
    groupPlanModalOptions,
    groupPlanModalDefaults,
    newPlansPageVariantV2,
    useNewPlanName,
    initialLocalizedGroupPrice:
      SubscriptionHelper.generateInitialLocalizedGroupPrice(
        recommendedCurrency
      ),
  })
}

// get to show the recurly.js page
async function paymentPage(req, res) {
  const user = SessionManager.getSessionUser(req.session)
  const plan = PlansLocator.findLocalPlanInSettings(req.query.planCode)
  if (!plan) {
    return HttpErrorHandler.unprocessableEntity(req, res, 'Plan not found')
  }
  const hasSubscription =
    await LimitationsManager.promises.userHasV1OrV2Subscription(user)
  if (hasSubscription) {
    res.redirect('/user/subscription?hasSubscription=true')
  } else {
    // LimitationsManager.userHasV2Subscription only checks Mongo. Double check with
    // Recurly as well at this point (we don't do this most places for speed).
    const valid =
      await SubscriptionHandler.promises.validateNoSubscriptionInRecurly(
        user._id
      )
    if (!valid) {
      res.redirect('/user/subscription?hasSubscription=true')
    } else {
      let currency = null
      if (req.query.currency) {
        const queryCurrency = req.query.currency.toUpperCase()
        if (GeoIpLookup.isValidCurrencyParam(queryCurrency)) {
          currency = queryCurrency
        }
      }
      const { currencyCode: recommendedCurrency, countryCode } =
        await GeoIpLookup.promises.getCurrencyCode(
          (req.query ? req.query.ip : undefined) || req.ip
        )
      if (recommendedCurrency && currency == null) {
        currency = recommendedCurrency
      }
      const assignment = await SplitTestHandler.promises.getAssignment(
        req,
        res,
        'payment-page'
      )
      const useUpdatedPaymentPage =
        assignment && assignment.variant === 'updated-payment-page'

      const refreshedPaymentPageAssignment =
        await SplitTestHandler.promises.getAssignment(
          req,
          res,
          'payment-page-refresh'
        )
      const useRefreshedPaymentPage =
        refreshedPaymentPageAssignment &&
        refreshedPaymentPageAssignment.variant === 'refreshed-payment-page'

      const template = useRefreshedPaymentPage
        ? 'subscriptions/new-refreshed'
        : useUpdatedPaymentPage
        ? 'subscriptions/new-updated'
        : 'subscriptions/new'

      res.render(template, {
        title: 'subscribe',
        currency,
        countryCode,
        plan,
        recurlyConfig: JSON.stringify({
          currency,
          subdomain: Settings.apis.recurly.subdomain,
        }),
        showCouponField: !!req.query.scf,
        showVatField: !!req.query.svf,
      })
    }
  }
}

async function userSubscriptionPage(req, res) {
  const user = SessionManager.getSessionUser(req.session)
  const results =
    await SubscriptionViewModelBuilder.promises.buildUsersSubscriptionViewModel(
      user
    )
  const {
    personalSubscription,
    memberGroupSubscriptions,
    managedGroupSubscriptions,
    currentInstitutionsWithLicence,
    managedInstitutions,
    managedPublishers,
    v1SubscriptionStatus,
  } = results
  const hasSubscription =
    await LimitationsManager.promises.userHasV1OrV2Subscription(user)
  const fromPlansPage = req.query.hasSubscription
  const plans = SubscriptionViewModelBuilder.buildPlansList(
    personalSubscription ? personalSubscription.plan : undefined
  )

  AnalyticsManager.recordEventForSession(req.session, 'subscription-page-view')

  const cancelButtonAssignment = await SplitTestHandler.promises.getAssignment(
    req,
    res,
    'subscription-cancel-button'
  )

  const cancelButtonNewCopy = cancelButtonAssignment?.variant === 'new-copy'

  const data = {
    title: 'your_subscription',
    plans,
    groupPlans: GroupPlansData,
    user,
    hasSubscription,
    fromPlansPage,
    personalSubscription,
    memberGroupSubscriptions,
    managedGroupSubscriptions,
    managedInstitutions,
    managedPublishers,
    v1SubscriptionStatus,
    currentInstitutionsWithLicence,
    groupPlanModalOptions,
    cancelButtonNewCopy,
  }
  res.render('subscriptions/dashboard', data)
}

async function interstitialPaymentPage(req, res) {
  const user = SessionManager.getSessionUser(req.session)
  const { currencyCode: recommendedCurrency } =
    await GeoIpLookup.promises.getCurrencyCode(
      (req.query ? req.query.ip : undefined) || req.ip
    )

  const hasSubscription =
    await LimitationsManager.promises.userHasV1OrV2Subscription(user)

  const showSkipLink = req.query?.skipLink === 'true'

  if (hasSubscription) {
    res.redirect('/user/subscription?hasSubscription=true')
  } else {
    res.render('subscriptions/interstitial-payment', {
      title: 'subscribe',
      itm_content: req.query && req.query.itm_content,
      itm_campaign: req.query?.itm_campaign,
      recommendedCurrency,
      interstitialPaymentConfig,
      showSkipLink,
    })
  }
}

async function createSubscription(req, res) {
  const user = SessionManager.getSessionUser(req.session)
  const recurlyTokenIds = {
    billing: req.body.recurly_token_id,
    threeDSecureActionResult:
      req.body.recurly_three_d_secure_action_result_token_id,
  }
  const { subscriptionDetails } = req.body

  const hasSubscription =
    await LimitationsManager.promises.userHasV1OrV2Subscription(user)

  if (hasSubscription) {
    logger.warn({ user_id: user._id }, 'user already has subscription')
    return res.sendStatus(409) // conflict
  }

  try {
    await SubscriptionHandler.promises.createSubscription(
      user,
      subscriptionDetails,
      recurlyTokenIds
    )

    res.sendStatus(201)
  } catch (err) {
    if (
      err instanceof SubscriptionErrors.RecurlyTransactionError ||
      err instanceof Errors.InvalidError
    ) {
      logger.error({ err }, 'recurly transaction error, potential 422')
      HttpErrorHandler.unprocessableEntity(
        req,
        res,
        err.message,
        OError.getFullInfo(err).public
      )
    } else {
      logger.warn(
        { err, user_id: user._id },
        'something went wrong creating subscription'
      )
    }
  }
}

async function successfulSubscription(req, res) {
  const user = SessionManager.getSessionUser(req.session)
  const { personalSubscription } =
    await SubscriptionViewModelBuilder.promises.buildUsersSubscriptionViewModel(
      user
    )

  const postCheckoutRedirect = req.session?.postCheckoutRedirect

  if (!personalSubscription) {
    res.redirect('/user/subscription/plans')
  } else {
    res.render('subscriptions/successful_subscription', {
      title: 'thank_you',
      personalSubscription,
      postCheckoutRedirect,
    })
  }
}

function cancelSubscription(req, res, next) {
  const user = SessionManager.getSessionUser(req.session)
  logger.debug({ user_id: user._id }, 'canceling subscription')
  SubscriptionHandler.cancelSubscription(user, function (err) {
    if (err) {
      OError.tag(err, 'something went wrong canceling subscription', {
        user_id: user._id,
      })
      return next(err)
    }
    // Note: this redirect isn't used in the main flow as the redirection is
    // handled by Angular
    res.redirect('/user/subscription/canceled')
  })
}

function canceledSubscription(req, res, next) {
  return res.render('subscriptions/canceled_subscription', {
    title: 'subscription_canceled',
  })
}

function cancelV1Subscription(req, res, next) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  logger.debug({ userId }, 'canceling v1 subscription')
  V1SubscriptionManager.cancelV1Subscription(userId, function (err) {
    if (err) {
      OError.tag(err, 'something went wrong canceling v1 subscription', {
        userId,
      })
      return next(err)
    }
    res.redirect('/user/subscription')
  })
}

function updateSubscription(req, res, next) {
  const origin = req && req.query ? req.query.origin : null
  const user = SessionManager.getSessionUser(req.session)
  const planCode = req.body.plan_code
  if (planCode == null) {
    const err = new Error('plan_code is not defined')
    logger.warn(
      { user_id: user._id, err, planCode, origin, body: req.body },
      '[Subscription] error in updateSubscription form'
    )
    return next(err)
  }
  logger.debug({ planCode, user_id: user._id }, 'updating subscription')
  SubscriptionHandler.updateSubscription(user, planCode, null, function (err) {
    if (err) {
      OError.tag(err, 'something went wrong updating subscription', {
        user_id: user._id,
      })
      return next(err)
    }
    res.redirect('/user/subscription')
  })
}

function cancelPendingSubscriptionChange(req, res, next) {
  const user = SessionManager.getSessionUser(req.session)
  logger.debug({ user_id: user._id }, 'canceling pending subscription change')
  SubscriptionHandler.cancelPendingSubscriptionChange(user, function (err) {
    if (err) {
      OError.tag(
        err,
        'something went wrong canceling pending subscription change',
        {
          user_id: user._id,
        }
      )
      return next(err)
    }
    res.redirect('/user/subscription')
  })
}

function updateAccountEmailAddress(req, res, next) {
  const user = SessionManager.getSessionUser(req.session)
  RecurlyWrapper.updateAccountEmailAddress(
    user._id,
    user.email,
    function (error) {
      if (error) {
        return next(error)
      }
      res.sendStatus(200)
    }
  )
}

function reactivateSubscription(req, res, next) {
  const user = SessionManager.getSessionUser(req.session)
  logger.debug({ user_id: user._id }, 'reactivating subscription')
  SubscriptionHandler.reactivateSubscription(user, function (err) {
    if (err) {
      OError.tag(err, 'something went wrong reactivating subscription', {
        user_id: user._id,
      })
      return next(err)
    }
    res.redirect('/user/subscription')
  })
}

function recurlyCallback(req, res, next) {
  logger.debug({ data: req.body }, 'received recurly callback')
  const event = Object.keys(req.body)[0]
  const eventData = req.body[event]

  RecurlyEventHandler.sendRecurlyAnalyticsEvent(event, eventData).catch(error =>
    logger.error(
      { err: error },
      'Failed to process analytics event on Recurly webhook'
    )
  )

  if (
    [
      'new_subscription_notification',
      'updated_subscription_notification',
      'expired_subscription_notification',
    ].includes(event)
  ) {
    const recurlySubscription = eventData.subscription
    SubscriptionHandler.syncSubscription(
      recurlySubscription,
      { ip: req.ip },
      function (err) {
        if (err) {
          return next(err)
        }
        res.sendStatus(200)
      }
    )
  } else if (event === 'billing_info_updated_notification') {
    const recurlyAccountCode = eventData.account.account_code
    SubscriptionHandler.attemptPaypalInvoiceCollection(
      recurlyAccountCode,
      function (err) {
        if (err) {
          return next(err)
        }
        res.sendStatus(200)
      }
    )
  } else {
    res.sendStatus(200)
  }
}

function renderUpgradeToAnnualPlanPage(req, res, next) {
  const user = SessionManager.getSessionUser(req.session)
  LimitationsManager.userHasV2Subscription(
    user,
    function (err, hasSubscription, subscription) {
      let planName
      if (err) {
        return next(err)
      }
      const planCode = subscription
        ? subscription.planCode.toLowerCase()
        : undefined
      if ((planCode ? planCode.indexOf('annual') : undefined) !== -1) {
        planName = 'annual'
      } else if ((planCode ? planCode.indexOf('student') : undefined) !== -1) {
        planName = 'student'
      } else if (
        (planCode ? planCode.indexOf('collaborator') : undefined) !== -1
      ) {
        planName = 'collaborator'
      }
      if (hasSubscription) {
        res.render('subscriptions/upgradeToAnnual', {
          title: 'Upgrade to annual',
          planName,
        })
      } else {
        res.redirect('/user/subscription/plans')
      }
    }
  )
}

function processUpgradeToAnnualPlan(req, res, next) {
  const user = SessionManager.getSessionUser(req.session)
  const { planName } = req.body
  const couponCode = Settings.coupon_codes.upgradeToAnnualPromo[planName]
  const annualPlanName = `${planName}-annual`
  logger.debug(
    { user_id: user._id, planName: annualPlanName },
    'user is upgrading to annual billing with discount'
  )
  return SubscriptionHandler.updateSubscription(
    user,
    annualPlanName,
    couponCode,
    function (err) {
      if (err) {
        OError.tag(err, 'error updating subscription', {
          user_id: user._id,
        })
        return next(err)
      }
      res.sendStatus(200)
    }
  )
}

async function extendTrial(req, res) {
  const user = SessionManager.getSessionUser(req.session)
  const { subscription } =
    await LimitationsManager.promises.userHasV2Subscription(user)

  try {
    await SubscriptionHandler.promises.extendTrial(subscription, 14)
    AnalyticsManager.recordEventForSession(
      req.session,
      'subscription-trial-extended'
    )
  } catch (error) {
    return res.sendStatus(500)
  }
  res.sendStatus(200)
}

function recurlyNotificationParser(req, res, next) {
  let xml = ''
  req.on('data', chunk => (xml += chunk))
  req.on('end', () =>
    RecurlyWrapper._parseXml(xml, function (error, body) {
      if (error) {
        return next(error)
      }
      req.body = body
      next()
    })
  )
}

async function refreshUserFeatures(req, res) {
  const { user_id: userId } = req.params
  await FeaturesUpdater.promises.refreshFeatures(userId, 'acceptance-test')
  res.sendStatus(200)
}

async function redirectToHostedPage(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { pageType } = req.params
  const url =
    await SubscriptionViewModelBuilder.promises.getRedirectToHostedPage(
      userId,
      pageType
    )
  logger.warn({ userId, pageType }, 'redirecting to recurly hosted page')
  res.redirect(url)
}

module.exports = {
  plansPage: expressify(plansPage),
  paymentPage: expressify(paymentPage),
  userSubscriptionPage: expressify(userSubscriptionPage),
  interstitialPaymentPage: expressify(interstitialPaymentPage),
  createSubscription: expressify(createSubscription),
  successfulSubscription: expressify(successfulSubscription),
  cancelSubscription,
  canceledSubscription,
  cancelV1Subscription,
  updateSubscription,
  cancelPendingSubscriptionChange,
  updateAccountEmailAddress,
  reactivateSubscription,
  recurlyCallback,
  renderUpgradeToAnnualPlanPage,
  processUpgradeToAnnualPlan,
  extendTrial: expressify(extendTrial),
  recurlyNotificationParser,
  refreshUserFeatures: expressify(refreshUserFeatures),
  redirectToHostedPage: expressify(redirectToHostedPage),
}
