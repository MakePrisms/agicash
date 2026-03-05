import { Info } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '~/components/ui/drawer';

const faqItems = [
  {
    question: 'Why Cash App?',
    answer:
      'Cash App is the first supported payment method because it natively supports Bitcoin Lightning payments.',
  },
  {
    question: "What if I don't have Cash App?",
    answer:
      "Don't worry, we're launching more payment options soon. In the meantime, you can receive bitcoin from any Bitcoin Lightning wallet by tapping the Receive button.",
  },
  {
    question: "Why isn't my Cash App loading?",
    answer: "Make sure you've downloaded the latest version.",
  },
  {
    question: 'What are the fees?',
    answer:
      'None. Agicash charges zero fees. Cash App charges zero fees. Your transaction executes at the mid-market rate, making this the cheapest way to buy bitcoin.',
  },
  {
    question: 'Is there a purchase limit?',
    answer:
      'Cash App has a $999/week limit on Lightning payments. This is a Cash App limit, not an Agicash limit.',
  },
  {
    question: 'How fast is it?',
    answer:
      'Instant. Your purchase and settlement happen in seconds over the Bitcoin Lightning Network.',
  },
];

export function BuyFaqDrawer() {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button type="button">
          <Info className="h-5 w-5 text-muted-foreground" />
        </button>
      </DrawerTrigger>
      <DrawerContent className="h-[90svh] font-primary">
        <div className="mx-auto flex h-full w-full max-w-sm flex-col overflow-hidden">
          <DrawerHeader className="mb-4 shrink-0">
            <DrawerTitle>Frequently Asked Questions</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
            <div className="space-y-6">
              {faqItems.map((item) => (
                <div key={item.question}>
                  <h3 className="font-semibold text-sm">{item.question}</h3>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
