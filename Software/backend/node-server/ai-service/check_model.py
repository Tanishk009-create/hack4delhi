import joblib

# Load the scaler (or the model)
scaler = joblib.load("scaler.pkl")

try:
    print("\n✅ EXACT FEATURE ORDER REQUIRED:")
    expected_features = list(scaler.feature_names_in_)
    
    # Print it formatted nicely so you can copy-paste it
    print("FEATURES = [")
    for feature in expected_features:
        print(f'    "{feature}",')
    print("]\n")
    
except AttributeError:
    print("Your scikit-learn version is older and doesn't save feature names.")
    print("You will need to check your original training notebook to see the exact column order of your DataFrame.")