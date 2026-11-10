#include <chrono>
#include <iostream>
#include <random>
#include "live_plot.h"
#include <windows.h>

int main() {
    std::random_device randomDevice;
    std::mt19937 generator(randomDevice());
    std::uniform_int_distribution<int> valueRange(10, 50);

    int valueA = valueRange(generator);
    int valueB = valueRange(generator);
    int valueC = valueRange(generator);

    for (int sample = 1; sample <= 20000; ++sample) {
        valueA = valueRange(generator);
        valueB = valueRange(generator);
        valueC = valueRange(generator);

        LIVE_PLOT(
            LIVE_PLOT_VALUE(valueA),
            LIVE_PLOT_VALUE(valueB),
            LIVE_PLOT_VALUE(valueC));

        std::cout << "Sample " << sample
                  << " | valueA=" << valueA
                  << " valueB=" << valueB
                  << " valueC=" << valueC << std::endl;

    }

    return 0;
}
