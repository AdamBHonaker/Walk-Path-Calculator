// Maps a calorie count to a relatable food-equivalent string ("≈ ½ a banana").
// Calorie figures are rough USDA / nutrition-label averages — meant to feel
// motivational, not be clinically precise.

export const CALORIE_FOODS = [
  { name: "cookie",         cal: 55,  plural: "cookies"         },
  { name: "banana",         cal: 90,  plural: "bananas"         },
  { name: "latte",          cal: 120, plural: "lattes"          },
  { name: "bag of chips",   cal: 130, plural: "bags of chips"   },
  { name: "can of soda",    cal: 150, plural: "cans of soda"    },
  { name: "granola bar",    cal: 190, plural: "granola bars"    },
  { name: "chocolate bar",  cal: 220, plural: "chocolate bars"  },
  { name: "small fries",    cal: 230, plural: "small fries"     },
  { name: "donut",          cal: 250, plural: "donuts"          },
  { name: "slice of pizza", cal: 300, plural: "slices of pizza" },
  { name: "cupcake",        cal: 350, plural: "cupcakes"        },
  { name: "cheeseburger",   cal: 550, plural: "cheeseburgers"   },
];

export const NICE_FRACS = [
  { val: 0.25, label: "¼ of a"  },
  { val: 0.33, label: "⅓ of a"  },
  { val: 0.5,  label: "half a"  },
  { val: 0.67, label: "⅔ of a"  },
  { val: 0.75, label: "¾ of a"  },
  { val: 1,    label: "1"       },
  { val: 1.5,  label: "1½"      },
  { val: 2,    label: "2"       },
  { val: 3,    label: "3"       },
  { val: 4,    label: "4"       },
];

export function calorieEquivalent(calories) {
  if (!calories || calories <= 0) return null;

  let bestFood = null;
  let bestFrac = null;
  let bestErr = Infinity;

  for (const food of CALORIE_FOODS) {
    const ratio = calories / food.cal;
    for (const frac of NICE_FRACS) {
      const err = Math.abs(ratio - frac.val);
      if (err < bestErr) {
        bestErr = err;
        bestFood = food;
        bestFrac = frac;
      }
    }
  }

  if (!bestFood) return null;
  const itemLabel = bestFrac.val >= 2 ? bestFood.plural : bestFood.name;
  return `≈ ${bestFrac.label} ${itemLabel}, returned to the day.`;
}
