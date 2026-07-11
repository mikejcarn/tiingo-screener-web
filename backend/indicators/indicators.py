import os
import pandas as pd
from pathlib import Path
import importlib.util
import importlib
from src.core.globals import TICKERS_DIR, INDICATORS_DIR, IND_CONF_DIR

# ===== BATCH PROCESSING FUNCTIONS =====


def run_indicators(ind_conf=None, timeframe=None):
    """
    Process indicators for multiple ticker files (batch processing).
    
    Args:
        ind_conf: Indicator config version ('1', '2', '3', '4')
        timeframe: Timeframe(s) to process (string, list, or None for all)
    """
    # Load config
    config_data = load_indicator_config(ind_conf)
    if config_data is None:
        return
    
    indicators_dict = config_data['indicators']
    params_dict = config_data['params']
    
    # Determine timeframes to process
    timeframes_to_process = _parse_timeframes(timeframe, indicators_dict)
    if timeframes_to_process is None:
        return
    
    output_dir = INDICATORS_DIR / f"ind_conf_{ind_conf}"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f'\n=== INDICATORS (Config: {ind_conf}) ===\n')
    print(f"Timeframes to process: {', '.join(timeframes_to_process)}")
    print(f"Input directory: {TICKERS_DIR}")
    print(f"Output directory: {output_dir}")

    # Process each timeframe
    for timeframe_name in timeframes_to_process:
        _process_timeframe_batch(
            timeframe_name, indicators_dict, params_dict, output_dir
        )
    
    print(f"\n\nAll indicators processed\n")


def _process_timeframe_batch(timeframe_name, indicators_dict, params_dict, output_dir):
    """Process all tickers for a specific timeframe"""
    if timeframe_name not in indicators_dict:
        print(f"\nWarning: No config found for timeframe '{timeframe_name}'")
        return

    indicator_list = indicators_dict[timeframe_name]
    timeframe_params = params_dict[timeframe_name]

    files = [
        f for f in os.listdir(TICKERS_DIR)
        if f.endswith('.csv') and len(f.split('_')) >= 3
        and f.split('_')[1].lower() == timeframe_name.lower()
    ]

    if not files:
        print(f"\nNo files found for timeframe: {timeframe_name}")
        return

    total_files = len(files)
    print(f"\nProcessing {timeframe_name} ({total_files} files)...")

    for processed_count, file in enumerate(files, 1):
        parts = file.split('_')
        ticker = parts[0]
        date_stamp = parts[2].replace('.csv', '')

        print(f"\r  {processed_count}/{total_files}: {str(ticker).strip().ljust(6)}", end="")

        try:
            df = pd.read_csv(
                os.path.join(TICKERS_DIR, file),
                parse_dates=['date'],
                index_col='date'
            )

            df_with_indicators = get_indicators(df, indicator_list, timeframe_params)

            _save_ticker(
                df=df_with_indicators,
                ticker=ticker,
                timeframe=timeframe_name,
                date_stamp=date_stamp,
                output_dir=output_dir
            )

        except Exception as e:
            print(f"\nError processing {ticker}_{timeframe_name}: {str(e)}")

    print(f"\n  {timeframe_name} complete!")

# ===== SINGLE DATAFRAME FUNCTIONS =====


def get_indicators(df, indicator_list, indicator_params=None):
    """
    Calculate and add indicators to a single DataFrame.
    
    Args:
        df: DataFrame with OHLCV data
        indicator_list: List of indicator names to calculate
        indicator_params: Dictionary of parameters for each indicator
    
    Returns:
        DataFrame with indicators added
    """
    if indicator_params is None:
        indicator_params = {}

    # Create a clean copy to work with
    result_df = df.copy()
    all_indicators = {}
    
    for indicator in indicator_list:
        module = importlib.import_module(f"src.indicators.indicators_list.{indicator}")
        params = indicator_params.get(indicator, {})
        indicator_values = module.calculate_indicator(result_df, **params)
        
        if isinstance(indicator_values, pd.DataFrame):
            # aVWAP (and similar) calls set_index('date') before returning,
            # leaving a DatetimeIndex that doesn't match result_df's RangeIndex.
            # When indices differ but row counts match, realign positionally.
            if not indicator_values.index.equals(result_df.index) and len(indicator_values) == len(result_df):
                indicator_values = indicator_values.copy()
                indicator_values.index = result_df.index
                if 'index' in indicator_values.columns:
                    indicator_values = indicator_values.drop(columns=['index'])
            result_df = pd.concat([result_df, indicator_values], axis=1)
        elif isinstance(indicator_values, dict):
            # Collect dictionary items for bulk addition
            all_indicators.update(indicator_values)
        else:
            all_indicators[indicator] = indicator_values
    
    # Add all collected indicators at once
    if all_indicators:
        indicators_df = pd.DataFrame(all_indicators)
        result_df = pd.concat([result_df, indicators_df], axis=1).copy()
    
    # Preserve original attributes
    result_df.attrs.update(df.attrs)
    
    return result_df

# ===== HELPER FUNCTIONS =====


def load_indicator_config(ind_conf, timeframe=None):
    """
    Load indicator configuration from IND_CONF_DIR.
    
    Args:
        ind_conf: Indicator config version ('1', '2', '3', '4')
        timeframe: Optional specific timeframe to extract
        
    Returns:
        If timeframe specified: (indicator_list, params_dict) for that timeframe
        If no timeframe: {'indicators': indicators_dict, 'params': params_dict} for all timeframes
        Returns None on error
    """
    if ind_conf is None:
        print("Error: Please specify an indicator config (e.g., '1', '2', '3', '4')")
        return None
    
    config_file = Path(IND_CONF_DIR) / f"ind_conf_{ind_conf}.py"
    
    if not config_file.exists():
        print(f"Error: Config file not found: {config_file}")
        
        # List available configs
        available_configs = []
        for f in Path(IND_CONF_DIR).glob('ind_conf_*.py'):
            config_num = f.stem.split('_')[-1]
            if config_num.isdigit():
                available_configs.append(config_num)
        
        if available_configs:
            print(f"Available configs: {', '.join(sorted(available_configs))}")
        else:
            print(f"No config files found in {IND_CONF_DIR}")
        
        return None
    
    try:
        # Dynamically import the config module
        spec = importlib.util.spec_from_file_location(f"ind_conf_{ind_conf}", config_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        # Check if module has required attributes
        if not hasattr(module, 'indicators') or not hasattr(module, 'params'):
            print(f"Error: Config file {config_file} missing 'indicators' or 'params'")
            return None
        
        if timeframe:
            # Extract specific timeframe config
            timeframe_lower = timeframe.lower()
            indicators_dict = module.indicators
            params_dict = module.params
            
            # Find matching timeframe (case-insensitive)
            for tf_key in indicators_dict.keys():
                if tf_key.lower() == timeframe_lower:
                    return indicators_dict[tf_key], params_dict[tf_key]
            
            # Not found
            print(f"Warning: No config for timeframe '{timeframe}' in ind_conf_{ind_conf}")
            return None, None
        else:
            # Return all timeframes
            return {
                'indicators': module.indicators,
                'params': module.params
            }
        
    except Exception as e:
        print(f"Error loading config {ind_conf}: {str(e)}")
        return None


def list_available_configs():
    """List all available config versions"""
    available_configs = []
    for f in Path(IND_CONF_DIR).glob('ind_conf_*.py'):
        config_num = f.stem.split('_')[-1]
        if config_num.isdigit():
            available_configs.append(config_num)
    return sorted(available_configs)


def _parse_timeframes(timeframe, indicators_dict):
    """Parse timeframe parameter into list of timeframes to process"""
    if timeframe is None:
        return list(indicators_dict.keys())
    elif isinstance(timeframe, str):
        return [timeframe.lower()]
    elif isinstance(timeframe, list):
        return [tf.lower() for tf in timeframe]
    else:
        print(f"Error: Invalid timeframe parameter type: {type(timeframe)}")
        return None



def _save_ticker(df, ticker, timeframe, date_stamp, output_dir):
    """Save one processed ticker immediately."""
    os.makedirs(output_dir, exist_ok=True)
    filename = f"{ticker}_{timeframe}_{date_stamp}.csv"
    filepath = os.path.join(output_dir, filename)
    
    df.to_csv(filepath, index=True, index_label="date")
