const DEBUG_MODE = true;

export function debug_log(...log_values)
{
  if (DEBUG_MODE)
  {
    console.info("Loot Sheet | ", ...log_values)
  }
}
