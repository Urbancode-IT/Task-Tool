/**
 * Icon catalogue for navigation customisation.
 *
 * The master console stores an icon by NAME (e.g. 'MdPeople') on the company
 * profile; the app resolves the name back to a component here. Only names in this
 * catalogue resolve, so a stored value can never inject an arbitrary component and
 * an unknown name falls back to the item's coded icon.
 *
 * To offer another icon, import it and add one entry.
 */
import {
  MdHome, MdDashboard, MdSpaceDashboard, MdInsights, MdChecklist, MdViewKanban,
  MdFolder, MdFolderSpecial, MdTableChart, MdOutlineAssignment, MdCalendarMonth,
  MdLink, MdHandshake, MdPeople, MdGroup, MdGroups, MdPerson, MdBusiness,
  MdBusinessCenter, MdCorporateFare, MdLock, MdLockOpen, MdVpnKey, MdShield,
  MdReceiptLong, MdPayments, MdAccountBalance, MdGavel, MdCampaign, MdShare,
  MdPublic, MdLanguage, MdAdminPanelSettings, MdSettings, MdTune, MdBuild,
  MdFactCheck, MdPendingActions, MdHistory, MdMonitorHeart, MdTrendingUp,
  MdBarChart, MdPieChart, MdTimeline, MdEmail, MdChat, MdNotifications,
  MdStar, MdFlag, MdBookmark, MdLabel, MdCategory, MdInventory, MdStorefront,
  MdShoppingCart, MdLocalShipping, MdSupport, MdSchool, MdMenuBook, MdArticle,
  MdDescription, MdCloud, MdStorage, MdTerminal, MdCode, MdBugReport,
  MdRocketLaunch, MdBolt, MdLightbulb, MdPalette, MdBrush, MdPhotoCamera,
  MdVideocam, MdMic, MdHeadphones, MdEvent, MdSchedule, MdAlarm, MdToday,
} from 'react-icons/md';

/** name → component. The key is what gets stored on the profile. */
export const NAV_ICONS = {
  MdHome, MdDashboard, MdSpaceDashboard, MdInsights, MdChecklist, MdViewKanban,
  MdFolder, MdFolderSpecial, MdTableChart, MdOutlineAssignment, MdCalendarMonth,
  MdLink, MdHandshake, MdPeople, MdGroup, MdGroups, MdPerson, MdBusiness,
  MdBusinessCenter, MdCorporateFare, MdLock, MdLockOpen, MdVpnKey, MdShield,
  MdReceiptLong, MdPayments, MdAccountBalance, MdGavel, MdCampaign, MdShare,
  MdPublic, MdLanguage, MdAdminPanelSettings, MdSettings, MdTune, MdBuild,
  MdFactCheck, MdPendingActions, MdHistory, MdMonitorHeart, MdTrendingUp,
  MdBarChart, MdPieChart, MdTimeline, MdEmail, MdChat, MdNotifications,
  MdStar, MdFlag, MdBookmark, MdLabel, MdCategory, MdInventory, MdStorefront,
  MdShoppingCart, MdLocalShipping, MdSupport, MdSchool, MdMenuBook, MdArticle,
  MdDescription, MdCloud, MdStorage, MdTerminal, MdCode, MdBugReport,
  MdRocketLaunch, MdBolt, MdLightbulb, MdPalette, MdBrush, MdPhotoCamera,
  MdVideocam, MdMic, MdHeadphones, MdEvent, MdSchedule, MdAlarm, MdToday,
};

/** Sorted names, for the picker grid. */
export const NAV_ICON_NAMES = Object.keys(NAV_ICONS).sort();

/** Resolve a stored icon name, or null when it is unknown/absent. */
export const iconByName = (name) =>
  (name && typeof name === 'string' && NAV_ICONS[name]) || null;

export default NAV_ICONS;
